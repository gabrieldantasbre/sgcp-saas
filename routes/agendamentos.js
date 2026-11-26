const router = require('express').Router();
const db = require('../db');
const { isValidDate, todayInSaoPaulo, localClinicDateTime, digits, cpfIsValid, normalizeClinicPhone } = require('../lib/domain');
const { validarResponsavel, registrarConsentimentoResponsavel } = require('../lib/guardian');
const { validarAceites, registrarAceites } = require('../lib/consent');
const { requireAuth, allowRoles, requirePermission, requirePermissionOrRole, requireSameOrigin } = require('../lib/auth');

const equipe = [requireAuth, requirePermission('agenda')];
const usuarios = [requireAuth, requirePermissionOrRole('agenda', 'PACIENTE')];
const LOCK_AGENDA = 7001;
const DURACAO_RESERVA_MIN = 60;

const SELECT_BASE = [
  'SELECT a.id, a.paciente_id, p.nome AS paciente_nome, p.telefone AS paciente_telefone, a.procedimento_id, pr.nome AS procedimento_nome, pr.valor_referencia,',
  "       to_char(a.data_hora, 'YYYY-MM-DD') AS data, to_char(a.data_hora, 'HH24:MI') AS hora,",
  '       a.data_hora, a.duracao_prevista_min, a.status, a.origem, a.tipo,',
  '       a.encaixe_urgencia, a.observacao',
  '  FROM agendamentos a',
  '  JOIN pacientes p ON p.id = a.paciente_id',
  '  LEFT JOIN procedimentos pr ON pr.id = a.procedimento_id',
].join(' ');

function horarioAtualSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return { data: get('year') + '-' + get('month') + '-' + get('day'), hora: get('hour') + ':' + get('minute') };
}

function minutos(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
}

function horariosDaClinica(data) {
  const semana = new Date(data + 'T12:00:00Z').getUTCDay();
  if (semana === 0) return [];
  const horas = semana === 6 ? [8, 9, 10, 11] : [8, 9, 10, 11, 13, 14, 15, 16, 17];
  return horas.map((h) => String(h).padStart(2, '0') + ':00');
}

function horarioValido(data, hora) {
  if (!isValidDate(data) || !/^(?:[01]\d|2[0-3]):00$/.test(hora)) return false;
  return horariosDaClinica(data).includes(hora);
}

function antecedenciaValida(data, hora) {
  const inicio = localClinicDateTime(data, hora).getTime();
  return inicio >= Date.now() + 30 * 60 * 1000;
}

function dataHoraBancoParaInstante(dataHora) {
  const texto = String(dataHora || '').replace(' ', 'T');
  return localClinicDateTime(texto.slice(0, 10), texto.slice(11, 16)).getTime();
}

async function buscarOcupados(cliente, data, excluirId) {
  const params = [data];
  let excluir = '';
  if (excluirId) {
    params.push(excluirId);
    excluir = ' AND id <> $2';
  }
  const { rows } = await cliente.query(
    "SELECT to_char(data_hora, 'HH24:MI') AS hora, duracao_prevista_min FROM agendamentos " +
    "WHERE status NOT IN ('CANCELADO', 'FALTOU') AND data_hora >= $1::date " +
    'AND data_hora < ($1::date + INTERVAL \'1 day\')' + excluir,
    params
  );
  const { rows: bloqueios } = await cliente.query(
    "SELECT to_char(inicio, 'HH24:MI') AS inicio, to_char(fim, 'HH24:MI') AS fim FROM bloqueios_agenda WHERE inicio >= $1::date AND inicio < $1::date + INTERVAL '1 day'", [data]
  );
  return rows.map((row) => ({
    inicio: minutos(row.hora),
    fim: minutos(row.hora) + Number(row.duracao_prevista_min),
  })).concat(bloqueios.map((row) => ({ inicio: minutos(row.inicio), fim: minutos(row.fim) })));
}

function listaHorariosLivres(data, ocupados) {
  return horariosDaClinica(data).filter((hora) => {
    if (data === horarioAtualSaoPaulo().data && !antecedenciaValida(data, hora)) return false;
    const inicio = minutos(hora);
    return !ocupados.some((ocupado) => inicio < ocupado.fim && inicio + DURACAO_RESERVA_MIN > ocupado.inicio);
  });
}

async function sugerirHorarios(cliente, dataInicial) {
  const sugestoes = [];
  const inicio = new Date(dataInicial + 'T12:00:00Z');
  for (let offset = 0; offset <= 21 && sugestoes.length < 6; offset++) {
    const data = new Date(inicio.getTime() + offset * 86400000).toISOString().slice(0, 10);
    if (!isValidDate(data) || data < todayInSaoPaulo()) continue;
    const ocupados = await buscarOcupados(cliente, data);
    for (const hora of listaHorariosLivres(data, ocupados)) {
      sugestoes.push({ data, hora });
      if (sugestoes.length === 6) break;
    }
  }
  return sugestoes;
}

function validarSolicitacao(body, user) {
  const pacienteId = user.perfil === 'PACIENTE' ? user.pacienteId : String(body.pacienteId ?? body.paciente_id ?? '');
  if (!pacienteId || !/^\d+$/.test(pacienteId)) return { erro: 'Selecione um paciente cadastrado.' };
  const procedimentoId = String(body.procedimentoId ?? body.procedimento_id ?? '');
  if (!/^\d+$/.test(procedimentoId)) return { erro: 'Selecione um serviço ativo.', campo: 'procedimentoId' };
  const data = String(body.data ?? '');
  if (!isValidDate(data) || data < todayInSaoPaulo()) return { erro: 'Escolha uma data válida, hoje ou futura.', campo: 'data' };
  const hora = String(body.hora ?? '');
  if (!horarioValido(data, hora)) return { erro: 'Esse horário está fora do funcionamento da clínica.', campo: 'hora' };
  if (!antecedenciaValida(data, hora)) return { erro: 'O agendamento precisa ser feito com pelo menos 30 minutos de antecedência.', campo: 'hora' };
  const tipo = String(body.tipo ?? 'CONSULTA').toUpperCase();
  if (!['CONSULTA', 'RETORNO'].includes(tipo)) return { erro: 'Tipo de consulta inválido.' };
  const origemInformada = String(body.origem ?? 'PRESENCIAL').toUpperCase();
  const origem = user.perfil === 'PACIENTE' ? 'ONLINE' : origemInformada;
  if (user.perfil !== 'PACIENTE' && !['PRESENCIAL', 'WHATSAPP'].includes(origem)) return { erro: 'Origem inválida.' };
  const observacao = String(body.observacao ?? '').trim();
  if (observacao.length > 255) return { erro: 'A observação deve ter no máximo 255 caracteres.', campo: 'observacao' };
  return {
    dados: {
      pacienteId,
      procedimentoId,
      data,
      hora,
      tipo,
      origem,
      status: user.perfil === 'PACIENTE' ? 'AGENDADO' : 'CONFIRMADO',
      encaixe: Boolean(body.encaixe),
      observacao: observacao || null,
    },
  };
}

router.get('/bloqueios', ...equipe, async (req, res, next) => {
  const de = String(req.query.de || todayInSaoPaulo());
  const ate = String(req.query.ate || de);
  if (!isValidDate(de) || !isValidDate(ate) || ate < de) return res.status(400).json({ erro: 'Período inválido.' });
  try {
    const { rows } = await db.query("SELECT id, to_char(inicio, 'YYYY-MM-DD') AS data, to_char(inicio, 'HH24:MI') AS inicio, to_char(fim, 'HH24:MI') AS fim, motivo FROM bloqueios_agenda WHERE inicio >= $1::date AND inicio < $2::date + INTERVAL '1 day' ORDER BY inicio", [de, ate]);
    res.json(rows);
  } catch (error) { next(error); }
});

router.post('/bloqueios', requireSameOrigin, ...equipe, async (req, res, next) => {
  const data = String(req.body?.data || '');
  const inicio = String(req.body?.inicio || '');
  const fim = String(req.body?.fim || '');
  const motivo = String(req.body?.motivo || '').trim();
  const horaValida = (hora) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora);
  if (!isValidDate(data) || data < todayInSaoPaulo() || !horaValida(inicio) || !horaValida(fim) || fim <= inicio || motivo.length > 160) return res.status(400).json({ erro: 'Informe uma data futura e um intervalo de horários válido no mesmo dia.' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [LOCK_AGENDA, data]);
    const ocupados = await buscarOcupados(client, data);
    if (ocupados.some((item) => minutos(inicio) < item.fim && minutos(fim) > item.inicio)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'O intervalo já possui consulta ou bloqueio. Libere o horário antes de bloquear.' });
    }
    const result = await client.query('INSERT INTO bloqueios_agenda (inicio, fim, motivo, registrado_por) VALUES ($1, $2, $3, $4) RETURNING id', [data + ' ' + inicio, data + ' ' + fim, motivo || null, req.user.id]);
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); next(error); }
  finally { client.release(); }
});

router.delete('/bloqueios/:id', requireSameOrigin, ...equipe, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  try {
    const result = await db.query('DELETE FROM bloqueios_agenda WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ erro: 'Bloqueio não encontrado.' });
    res.status(204).end();
  } catch (error) { next(error); }
});

const pedidosPublicos = new Map();
router.post('/publico', requireSameOrigin, async (req, res, next) => {
  const agora = Date.now();
  const recentes = (pedidosPublicos.get(req.ip) || []).filter((item) => agora - item < 15 * 60 * 1000);
  if (recentes.length >= 8) return res.status(429).json({ erro: 'Muitas solicitações. Aguarde 15 minutos.' });
  pedidosPublicos.set(req.ip, [...recentes, agora]);
  for (const [ip, times] of pedidosPublicos) if (!times.some((item) => agora - item < 15 * 60 * 1000)) pedidosPublicos.delete(ip);
  const body = req.body || {};
  const erroAceite = validarAceites(body);
  if (erroAceite) return res.status(400).json({ erro: erroAceite, codigo: 'DADOS_PACIENTE_INVALIDOS', campo: 'aceitouTermos' });
  const nome = String(body.nome || '').trim();
  const cpf = digits(body.cpf);
  const telefoneInformado = String(body.telefone || '').trim();
  const telefone = normalizeClinicPhone(telefoneInformado);
  const nascimento = String(body.nascimento || '');
  const email = String(body.email || '').trim().toLowerCase();
  const responsavel = validarResponsavel(body, nascimento);
  const solicitacao = validarSolicitacao(body, { perfil: 'PACIENTE', pacienteId: '1' });
  if (solicitacao.erro) return res.status(400).json({ ...solicitacao, codigo: 'DADOS_AGENDAMENTO_INVALIDOS' });
  if (responsavel.erro) return res.status(400).json({ erro: responsavel.erro, codigo: 'DADOS_RESPONSAVEL_INVALIDOS' });
  const camposInvalidos = [
    [nome.length < 3 || nome.length > 120, 'nome', 'Informe o nome completo do paciente, entre 3 e 120 caracteres.'],
    [!cpfIsValid(cpf, true), 'cpf', 'Informe um CPF válido do paciente. Confira os 11 dígitos.'],
    [!/^\d{10,11}$/.test(telefone) || telefoneInformado.length > 20, 'telefone', 'Informe o celular com DDD, com ou sem o código do Brasil (+55).'],
    [!isValidDate(nascimento) || nascimento > todayInSaoPaulo(), 'nascimento', 'Informe uma data de nascimento válida.'],
    [email && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 160), 'email', 'Confira o e-mail informado ou deixe esse campo em branco.'],
    [body.aceitouAvisoPrivacidade !== true, 'aceitouAvisoPrivacidade', 'Confirme que leu o Aviso de Privacidade.'],
  ];
  const invalido = camposInvalidos.find(([condicao]) => condicao);
  if (invalido) return res.status(400).json({ erro: invalido[2], codigo: 'DADOS_PACIENTE_INVALIDOS', campo: invalido[1] });
  const dados = solicitacao.dados;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7002, hashtext($1))', [cpf]);
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [LOCK_AGENDA, dados.data]);
    const servico = await client.query('SELECT id FROM procedimentos WHERE id = $1 AND ativo = TRUE', [dados.procedimentoId]);
    if (!servico.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ erro: 'Serviço indisponível.', codigo: 'SERVICO_INDISPONIVEL', campo: 'procedimentoId' }); }
    const ocupados = await buscarOcupados(client, dados.data);
    const inicio = minutos(dados.hora);
    if (ocupados.some((item) => inicio < item.fim && inicio + DURACAO_RESERVA_MIN > item.inicio)) { await client.query('ROLLBACK'); return res.status(409).json({ erro: 'O horário ficou indisponível. Escolha outro.', codigo: 'HORARIO_INDISPONIVEL' }); }
    let paciente = (await client.query('SELECT id, nome, telefone, data_nascimento FROM pacientes WHERE cpf = $1 FOR UPDATE', [cpf])).rows[0];
    if (paciente && (paciente.nome.trim().toLocaleLowerCase('pt-BR') !== nome.toLocaleLowerCase('pt-BR') || normalizeClinicPhone(paciente.telefone) !== telefone || (paciente.data_nascimento && paciente.data_nascimento !== nascimento))) {
      await client.query('ROLLBACK'); return res.status(409).json({ erro: 'Você pode agendar sem cadastro prévio. Porém, o CPF informado já está vinculado a um cadastro com dados diferentes. Confira o CPF e os dados do paciente ou fale com a recepção para atualizar esse cadastro.', codigo: 'DADOS_PACIENTE_DIVERGENTES' });
    }
    if (!paciente) paciente = (await client.query('INSERT INTO pacientes (nome, cpf, telefone, data_nascimento, email) VALUES ($1, $2, $3, $4, $5) RETURNING id', [nome, cpf, telefone, nascimento, email || null])).rows[0];
    await registrarConsentimentoResponsavel(client, paciente.id, responsavel.dados, 'AGENDAMENTO_PUBLICO');
    await registrarAceites(client, paciente.id, 'AGENDAMENTO_PUBLICO');
    const result = await client.query("INSERT INTO agendamentos (paciente_id, procedimento_id, data_hora, duracao_prevista_min, status, origem, tipo, observacao) VALUES ($1, $2, $3, $4, 'AGENDADO', 'ONLINE', 'CONSULTA', $5) RETURNING id", [paciente.id, dados.procedimentoId, dados.data + ' ' + dados.hora, DURACAO_RESERVA_MIN, dados.observacao]);
    await client.query('COMMIT');
    res.status(201).json({ id: result.rows[0].id, data: dados.data, hora: dados.hora });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ erro: 'O horário acabou de ser ocupado. Escolha outro.', codigo: 'HORARIO_INDISPONIVEL' });
    next(error);
  } finally { client.release(); }
});

router.get('/disponibilidade', async (req, res, next) => {
  const de = String(req.query.de || todayInSaoPaulo());
  const ate = String(req.query.ate || '');
  if (!isValidDate(de) || de < todayInSaoPaulo() || (ate && (!isValidDate(ate) || ate < de))) {
    return res.status(400).json({ erro: 'Período de consulta inválido.' });
  }
  if (ate && (new Date(ate) - new Date(de)) / 86400000 > 31) return res.status(400).json({ erro: 'Consulte até 31 dias por vez.' });
  const procedimentoId = String(req.query.procedimentoId || '');
  if (!/^\d+$/.test(procedimentoId)) return res.status(400).json({ erro: 'Selecione um serviço.' });
  try {
    const { rows: procedimentos } = await db.query('SELECT id FROM procedimentos WHERE id = $1 AND ativo = TRUE', [procedimentoId]);
    if (!procedimentos[0]) return res.status(404).json({ erro: 'Serviço não encontrado.' });
    const dias = [];
    const limite = ate || new Date(new Date(de + 'T12:00:00Z').getTime() + 20 * 86400000).toISOString().slice(0, 10);
    for (let cursor = new Date(de + 'T12:00:00Z'); cursor.toISOString().slice(0, 10) <= limite && dias.length < 31; cursor = new Date(cursor.getTime() + 86400000)) {
      const data = cursor.toISOString().slice(0, 10);
      const ocupados = await buscarOcupados(db, data);
      const horarios = listaHorariosLivres(data, ocupados);
      if (horarios.length) dias.push({ data, horarios });
    }
    res.json({ dias });
  } catch (error) {
    next(error);
  }
});

router.get('/pendencias', ...equipe, async (req, res, next) => {
  try {
    const { rows } = await db.query('WITH pendencias AS (' + SELECT_BASE +
      " WHERE a.status = 'AGENDADO' AND a.data_hora >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')) " +
      'SELECT *, COUNT(*) OVER () AS total FROM pendencias ORDER BY data, hora, id LIMIT 50');
    res.json({ total: Number(rows[0]?.total || 0), consultas: rows.map(({ total, ...item }) => item) });
  } catch (error) { next(error); }
});

router.get('/', ...usuarios, async (req, res, next) => {
  const de = String(req.query.de || todayInSaoPaulo());
  const ate = String(req.query.ate || '');
  if (!isValidDate(de) || (ate && !isValidDate(ate))) return res.status(400).json({ erro: 'Período inválido.' });
  try {
    const params = [];
    let filtro;
    if (req.user.perfil === 'PACIENTE') {
      params.push(req.user.pacienteId);
      filtro = 'WHERE a.paciente_id = $1';
    } else {
      params.push(de);
      filtro = 'WHERE a.data_hora >= $1::date';
      if (ate) {
        params.push(ate);
        filtro += ' AND a.data_hora < ($2::date + INTERVAL \'1 day\')';
      }
      if (req.query.status) {
        params.push(String(req.query.status).toUpperCase());
        filtro += ' AND a.status = $' + params.length;
      }
    }
    const { rows } = await db.query(
      SELECT_BASE + ' ' + filtro + ' ORDER BY a.data_hora DESC LIMIT 500',
      params
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', ...usuarios, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  try {
    const params = [req.params.id];
    let filter = ' WHERE a.id = $1';
    if (req.user.perfil === 'PACIENTE') {
      params.push(req.user.pacienteId);
      filter += ' AND a.paciente_id = $2';
    }
    const { rows } = await db.query(SELECT_BASE + filter, params);
    if (!rows[0]) return res.status(404).json({ erro: 'Consulta não encontrada.' });
    res.json(rows[0]);
  } catch (error) { next(error); }
});

router.post('/', requireSameOrigin, ...usuarios, async (req, res, next) => {
  const { erro, dados } = validarSolicitacao(req.body || {}, req.user);
  if (erro) return res.status(400).json({ erro });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [LOCK_AGENDA, dados.data]);
    const { rows: paciente } = await client.query('SELECT id, cadastro_completo FROM pacientes WHERE id = $1', [dados.pacienteId]);
    if (!paciente[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Paciente não encontrado.' });
    }
    if (!paciente[0].cadastro_completo) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Complete os dados de atendimento no perfil antes de agendar.', codigo: 'PERFIL_INCOMPLETO' });
    }
    const { rows: procedimento } = await client.query('SELECT id FROM procedimentos WHERE id = $1 AND ativo = TRUE', [dados.procedimentoId]);
    if (!procedimento[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Serviço não encontrado ou inativo.' });
    }
    const ocupados = await buscarOcupados(client, dados.data);
    const inicio = minutos(dados.hora);
    const conflito = ocupados.some((item) => inicio < item.fim && inicio + DURACAO_RESERVA_MIN > item.inicio);
    if (conflito) {
      const sugestoes = await sugerirHorarios(client, dados.data);
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Horário indisponível. Escolha uma das opções livres.', sugestoes });
    }
    const { rows } = await client.query(
      'INSERT INTO agendamentos (paciente_id, procedimento_id, registrado_por, data_hora, duracao_prevista_min, status, origem, tipo, encaixe_urgencia, observacao) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
      [
        dados.pacienteId, dados.procedimentoId, req.user.id,
        dados.data + ' ' + dados.hora + ':00', DURACAO_RESERVA_MIN,
        dados.status, dados.origem, dados.tipo, dados.encaixe, dados.observacao,
      ]
    );
    const novo = await client.query(SELECT_BASE + ' WHERE a.id = $1', [rows[0].id]);
    await client.query('COMMIT');
    res.status(201).json(novo.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ erro: 'O horário acabou de ser ocupado. Atualize os horários disponíveis.' });
    next(error);
  } finally {
    client.release();
  }
});

router.patch('/:id/status', requireSameOrigin, ...equipe, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const novoStatus = String(req.body?.status || '').toUpperCase();
  if (!['CONFIRMADO', 'CANCELADO', 'FALTOU'].includes(novoStatus)) {
    return res.status(400).json({ erro: 'Status inválido. O atendimento é concluído pelo módulo de atendimento.' });
  }
  const transicoes = {
    AGENDADO: ['CONFIRMADO', 'CANCELADO', 'FALTOU'],
    CONFIRMADO: ['CANCELADO', 'FALTOU'],
  };
  try {
    const { rows } = await db.query('SELECT status FROM agendamentos WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    if (!(transicoes[rows[0].status] || []).includes(novoStatus)) {
      return res.status(409).json({ erro: 'Esta mudança de situação não é permitida.' });
    }
    const updated = await db.query('UPDATE agendamentos SET status = $1 WHERE id = $2', [novoStatus, req.params.id]);
    if (!updated.rowCount) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    const result = await db.query(SELECT_BASE + ' WHERE a.id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/cancelar', requireSameOrigin, ...usuarios, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  try {
    const { rows } = await db.query("SELECT id, paciente_id, to_char(data_hora, 'YYYY-MM-DD HH24:MI') AS data_hora, status FROM agendamentos WHERE id = $1", [req.params.id]);
    const appointment = rows[0];
    if (!appointment) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    if (req.user.perfil === 'PACIENTE') {
      if (String(appointment.paciente_id) !== req.user.pacienteId) return res.status(403).json({ erro: 'Você só pode alterar suas próprias consultas.' });
      if (!['AGENDADO', 'CONFIRMADO'].includes(appointment.status)) return res.status(409).json({ erro: 'Esta consulta não pode mais ser cancelada pelo portal.' });
      if (dataHoraBancoParaInstante(appointment.data_hora) - Date.now() < 2 * 60 * 60 * 1000) {
        return res.status(409).json({ erro: 'Pelo portal, o cancelamento precisa ser feito com pelo menos 2 horas de antecedência. Entre em contato com a clínica.' });
      }
    }
    const result = await db.query("UPDATE agendamentos SET status = 'CANCELADO' WHERE id = $1 AND status IN ('AGENDADO', 'CONFIRMADO') RETURNING id", [req.params.id]);
    if (!result.rowCount) return res.status(409).json({ erro: 'Esta consulta não pode mais ser cancelada.' });
    const updated = await db.query(SELECT_BASE + ' WHERE a.id = $1', [req.params.id]);
    res.json(updated.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/remarcar', requireSameOrigin, requireAuth, allowRoles('PACIENTE'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const dados = {
    data: String(req.body?.data || ''),
    hora: String(req.body?.hora || ''),
    procedimentoId: String(req.body?.procedimentoId || ''),
  };
  if (!/^\d+$/.test(dados.procedimentoId) || !horarioValido(dados.data, dados.hora) ||
      dados.data < todayInSaoPaulo() || !antecedenciaValida(dados.data, dados.hora)) {
    return res.status(400).json({ erro: 'Escolha um novo horário válido com pelo menos 30 minutos de antecedência.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [LOCK_AGENDA, dados.data]);
    const { rows } = await client.query(
      "SELECT id, paciente_id, to_char(data_hora, 'YYYY-MM-DD HH24:MI') AS data_hora, status FROM agendamentos WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );
    const appointment = rows[0];
    if (!appointment || String(appointment.paciente_id) !== req.user.pacienteId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Consulta não encontrada.' });
    }
    if (!['AGENDADO', 'CONFIRMADO'].includes(appointment.status) ||
        dataHoraBancoParaInstante(appointment.data_hora) - Date.now() < 2 * 60 * 60 * 1000) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Pelo portal, a remarcação precisa ser feita com pelo menos 2 horas de antecedência.' });
    }
    const { rows: procedimento } = await client.query('SELECT id FROM procedimentos WHERE id = $1 AND ativo = TRUE', [dados.procedimentoId]);
    if (!procedimento[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Serviço não encontrado.' });
    }
    const ocupados = await buscarOcupados(client, dados.data, req.params.id);
    const inicio = minutos(dados.hora);
    if (ocupados.some((item) => inicio < item.fim && inicio + DURACAO_RESERVA_MIN > item.inicio)) {
      const sugestoes = await sugerirHorarios(client, dados.data);
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Horário indisponível. Escolha outro horário.', sugestoes });
    }
    await client.query(
      "UPDATE agendamentos SET procedimento_id = $1, data_hora = $2, duracao_prevista_min = $3, status = 'AGENDADO', origem = 'ONLINE' WHERE id = $4",
      [dados.procedimentoId, dados.data + ' ' + dados.hora + ':00', DURACAO_RESERVA_MIN, req.params.id]
    );
    const updated = await client.query(SELECT_BASE + ' WHERE a.id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ erro: 'O horário acabou de ser ocupado. Escolha outro.' });
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
