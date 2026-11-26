const router = require('express').Router();
const db = require('../db');
const crypto = require('node:crypto');
const { digits, cpfIsValid, isValidDate, todayInSaoPaulo } = require('../lib/domain');
const { requireAuth, allowRoles, requirePermission, requireSameOrigin } = require('../lib/auth');
const { validarResponsavel, registrarConsentimentoResponsavel } = require('../lib/guardian');

const COLUNAS = 'id, nome, cpf, telefone, email, data_nascimento, endereco, data_cadastro';
const equipe = [requireAuth, requirePermission('pacientes')];
const texto = (value) => String(value ?? '').trim();
const emailValido = (value) => /^\S+@\S+\.\S+$/.test(value);

function validar(body) {
  const nome = texto(body.nome);
  if (nome.length < 3 || nome.length > 120) return { erro: 'Informe o nome completo (3 a 120 caracteres).' };
  const cpf = digits(body.cpf);
  if (!cpfIsValid(cpf, true)) return { erro: 'CPF inválido.' };
  const nascimento = texto(body.nascimento ?? body.data_nascimento);
  if (!isValidDate(nascimento) || nascimento > todayInSaoPaulo()) return { erro: 'Informe uma data de nascimento válida.' };
  const responsavel = validarResponsavel(body, nascimento);
  if (responsavel.erro) return responsavel;
  const email = texto(body.email).toLowerCase() || null;
  if (email && !emailValido(email)) return { erro: 'E-mail inválido.' };
  const telefone = texto(body.telefone) || null;
  if (telefone && digits(telefone).length < 10) return { erro: 'Informe um telefone válido.' };
  const endereco = texto(body.endereco) || null;
  return { dados: { nome, cpf, nascimento, email, telefone, endereco, responsavel: responsavel.dados } };
}

async function erroDuplicidade(error, res, cpf) {
  if (error.code !== '23505') return false;
  if (String(error.constraint || '').includes('cpf')) {
    const { rows } = await db.query('SELECT nome FROM pacientes WHERE cpf = $1', [cpf]);
    return res.status(409).json({ erro: 'Este CPF já está cadastrado' + (rows[0] ? ': ' + rows[0].nome + '.' : '.' ) });
  }
  return res.status(409).json({ erro: 'Já existe um paciente com estes dados.' });
}

router.get('/', ...equipe, async (req, res, next) => {
  try {
    const busca = texto(req.query.busca);
    const params = [];
    let where = '';
    if (busca) {
      params.push('%' + busca + '%');
      where = 'WHERE nome ILIKE $1';
      const cpf = digits(busca);
      if (cpf) {
        params.push('%' + cpf + '%');
        where += ' OR cpf LIKE $2';
      }
    }
    const { rows } = await db.query(
      'SELECT ' + COLUNAS + ' FROM pacientes ' + where + ' ORDER BY nome LIMIT 500',
      params
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/opcoes', requireAuth, async (req, res, next) => {
  const uso = String(req.query.uso || '');
  const permissaoPorUso = { agenda: 'agenda', atendimento: 'atendimento', receitas: 'receitas' };
  const permissao = permissaoPorUso[uso];
  if (!permissao) return res.status(400).json({ erro: 'Informe um uso válido para a lista de pacientes.' });
  if (req.user.perfil !== 'PODOLOGA' && !req.user.permissoes.includes(permissao)) {
    return res.status(403).json({ erro: 'Seu perfil não tem permissão para acessar estes dados.' });
  }
  try {
    const { rows } = await db.query('SELECT id, nome FROM pacientes ORDER BY nome LIMIT 1000');
    res.json(rows.map((patient) => ({ id: String(patient.id), nome: patient.nome })));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/perfil', requireAuth, requirePermission('pacientes'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const permissoes = {
    agenda: req.user.perfil === 'PODOLOGA' || req.user.permissoes.includes('agenda'),
    atendimento: req.user.perfil === 'PODOLOGA' || req.user.permissoes.includes('atendimento'),
    receitas: req.user.perfil === 'PODOLOGA' || req.user.permissoes.includes('receitas'),
  };
  try {
    const [cadastro, consultas, saude, atendimentos, pagamentos] = await Promise.all([
      db.query(
        "SELECT id, nome, cpf, telefone, email, to_char(data_nascimento, 'YYYY-MM-DD') AS data_nascimento, endereco, " +
        "to_char(data_cadastro, 'YYYY-MM-DD') AS data_cadastro FROM pacientes WHERE id = $1",
        [req.params.id]
      ),
      permissoes.agenda ? db.query(
        "SELECT a.id, a.paciente_id, to_char(a.data_hora, 'YYYY-MM-DD') AS data, to_char(a.data_hora, 'HH24:MI') AS hora, " +
        'a.status, a.tipo, a.origem, a.observacao, pr.nome AS procedimento_nome, COUNT(*) OVER() AS total ' +
        'FROM agendamentos a LEFT JOIN procedimentos pr ON pr.id = a.procedimento_id WHERE a.paciente_id = $1 ' +
        'ORDER BY a.data_hora DESC LIMIT 200', [req.params.id]
      ) : Promise.resolve({ rows: [] }),
      permissoes.atendimento ? db.query(
        "SELECT id, to_char(data_preenchimento, 'YYYY-MM-DD') AS data_preenchimento, queixa_principal, diabetico, hipertenso, problema_circulatorio, " +
        'alergias, medicamentos_em_uso, cirurgias_anteriores, tipo_calcado, observacoes, COUNT(*) OVER() AS total ' +
        'FROM fichas_anamnese WHERE paciente_id = $1 ORDER BY data_preenchimento DESC, id DESC LIMIT 100', [req.params.id]
      ) : Promise.resolve({ rows: [] }),
      permissoes.atendimento ? db.query(
        "SELECT a.id, to_char(a.inicio, 'YYYY-MM-DD') AS data, to_char(a.inicio, 'HH24:MI') AS hora, a.valor_final, a.status, " +
        'a.queixa, a.evolucao, a.orientacoes, COALESCE(string_agg(pr.nome, \', \' ORDER BY pr.nome), \'\') AS procedimentos, COUNT(*) OVER() AS total ' +
        'FROM atendimentos a LEFT JOIN itens_atendimento i ON i.atendimento_id = a.id ' +
        'LEFT JOIN procedimentos pr ON pr.id = i.procedimento_id WHERE a.paciente_id = $1 ' +
        'GROUP BY a.id ORDER BY a.inicio DESC LIMIT 200', [req.params.id]
      ) : Promise.resolve({ rows: [] }),
      permissoes.receitas ? db.query(
        "SELECT id, categoria, descricao, valor, status, to_char(data, 'YYYY-MM-DD') AS data, " +
        "to_char(data_pagamento, 'YYYY-MM-DD') AS data_pagamento, forma_pagamento, COUNT(*) OVER() AS total " +
        "FROM movimentacoes_financeiras WHERE paciente_id = $1 AND tipo = 'RECEITA' " +
        'ORDER BY COALESCE(data_pagamento, data) DESC, id DESC LIMIT 200', [req.params.id]
      ) : Promise.resolve({ rows: [] }),
    ]);
    if (!cadastro.rows[0]) return res.status(404).json({ erro: 'Paciente não encontrado.' });
    const total = (result) => Number(result.rows[0]?.total || 0);
    res.json({
      cadastro: cadastro.rows[0],
      consultas: consultas.rows,
      saude: saude.rows,
      atendimentos: atendimentos.rows,
      pagamentos: pagamentos.rows,
      permissoes,
      resumo: { consultas: total(consultas), saude: total(saude), atendimentos: total(atendimentos), pagamentos: total(pagamentos) },
    });
  } catch (error) { next(error); }
});

// A proprietária confere a identidade e entrega o link diretamente ao paciente.
router.post('/:id/convite-portal', requireSameOrigin, requireAuth, allowRoles('PODOLOGA'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const paciente = await client.query('SELECT id FROM pacientes WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!paciente.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ erro: 'Paciente não encontrado.' }); }
    const conta = await client.query('SELECT 1 FROM usuarios WHERE paciente_id = $1', [req.params.id]);
    if (conta.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ erro: 'Este paciente já possui uma conta no portal.' }); }
    const token = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows } = await client.query(
      "INSERT INTO convites_portal (paciente_id, token_hash, criado_por, expira_em) VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '24 hours') " +
      'ON CONFLICT (paciente_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, criado_por = EXCLUDED.criado_por, criado_em = CURRENT_TIMESTAMP, expira_em = EXCLUDED.expira_em, usado_em = NULL RETURNING expira_em',
      [req.params.id, hash, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ token, expiraEm: rows[0].expira_em });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); next(error); }
  finally { client.release(); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const allowed = req.user.perfil === 'PODOLOGA' || req.user.permissoes.includes('pacientes') ||
    (req.user.perfil === 'PACIENTE' && req.user.pacienteId === req.params.id);
  if (!allowed) return res.status(403).json({ erro: 'Você só pode consultar o próprio cadastro.' });
  try {
    const { rows } = await db.query('SELECT ' + COLUNAS + ' FROM pacientes WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ erro: 'Paciente não encontrado.' });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.post('/', requireSameOrigin, ...equipe, async (req, res, next) => {
  const { erro, dados } = validar(req.body || {});
  if (erro) return res.status(400).json({ erro });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO pacientes (nome, cpf, data_nascimento, telefone, email, endereco) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ' + COLUNAS,
      [dados.nome, dados.cpf, dados.nascimento, dados.telefone, dados.email, dados.endereco]
    );
    await registrarConsentimentoResponsavel(client, rows[0].id, dados.responsavel, 'CLINICA', req.user.id);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const handled = await erroDuplicidade(error, res, dados.cpf);
    if (handled) return;
    next(error);
  } finally {
    client.release();
  }
});

router.put('/:id', requireSameOrigin, ...equipe, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const { erro, dados } = validar(req.body || {});
  if (erro) return res.status(400).json({ erro });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE pacientes SET nome = $1, cpf = $2, data_nascimento = $3, telefone = $4, email = $5, endereco = $6, cadastro_completo = TRUE WHERE id = $7 RETURNING ' + COLUNAS,
      [dados.nome, dados.cpf, dados.nascimento, dados.telefone, dados.email, dados.endereco, req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Paciente não encontrado.' });
    }
    await registrarConsentimentoResponsavel(client, rows[0].id, dados.responsavel, 'CLINICA', req.user.id);
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const handled = await erroDuplicidade(error, res, dados.cpf);
    if (handled) return;
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
