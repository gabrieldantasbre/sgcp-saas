const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const crypto = require('node:crypto');
const { digits, cpfIsValid, isValidDate, todayInSaoPaulo } = require('../lib/domain');
const { requireAuth, setSessionCookie, clearSessionCookie, requireSameOrigin } = require('../lib/auth');
const { menorDeIdade, validarResponsavel, registrarConsentimentoResponsavel } = require('../lib/guardian');
const { validarAceites, registrarAceites } = require('../lib/consent');

router.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return requireSameOrigin(req, res, next);
  return next();
});

const texto = (value) => String(value ?? '').trim();
const emailValido = (value) => /^\S+@\S+\.\S+$/.test(value);
const senhaValida = (value) => typeof value === 'string' && value.length >= 10 && value.length <= 128;

function validarNascimento(value) {
  if (!value) return true;
  return isValidDate(value) && value <= todayInSaoPaulo();
}

function usuarioSeguro(user) {
  return {
    id: String(user.id),
    nome: user.nome,
    email: user.email,
    perfil: user.perfil,
    pacienteId: user.paciente_id == null ? null : String(user.paciente_id),
  };
}

router.get('/setup/status', async (req, res, next) => {
  try {
    const { rows } = await db.query("SELECT EXISTS (SELECT 1 FROM usuarios WHERE perfil = 'PODOLOGA') AS configurado");
    res.json({ configurado: rows[0].configurado });
  } catch (error) {
    next(error);
  }
});

router.post('/setup', async (req, res, next) => {
  const nome = texto(req.body?.nome);
  const email = texto(req.body?.email).toLowerCase();
  const senha = req.body?.senha;
  const registro = texto(req.body?.registroProfissional);
  if (nome.length < 3 || !emailValido(email) || !senhaValida(senha) || registro.length < 2) {
    return res.status(400).json({ erro: 'Informe nome, e-mail, senha com ao menos 10 caracteres e registro profissional.' });
  }

  const senhaHash = await bcrypt.hash(senha, 12);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sgcp_setup_owner'))");
    const { rows: proprietaria } = await client.query("SELECT 1 FROM usuarios WHERE perfil = 'PODOLOGA' LIMIT 1");
    if (proprietaria.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'A configuração inicial já foi concluída.' });
    }
    const { rows } = await client.query(
      "INSERT INTO usuarios (nome, email, senha_hash, perfil, registro_profissional) VALUES ($1, $2, $3, 'PODOLOGA', $4) RETURNING id, nome, email, perfil, paciente_id",
      [nome, email, senhaHash, registro]
    );
    await client.query('COMMIT');
    setSessionCookie(res, rows[0].id, false);
    res.status(201).json({ usuario: usuarioSeguro(rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ erro: 'Já existe uma conta com esse e-mail.' });
    next(error);
  } finally {
    client.release();
  }
});

router.post('/cadastro-paciente', async (req, res, next) => {
  const cpf = digits(req.body?.cpf);
  const email = texto(req.body?.email).toLowerCase();
  const senha = req.body?.senha;
  const faixaEtaria = req.body?.faixaEtaria;
  const erroAceite = validarAceites(req.body);
  if (erroAceite) return res.status(400).json({ erro: erroAceite });
  if (!['ADULTO', 'MENOR'].includes(faixaEtaria)) {
    return res.status(400).json({ erro: 'Informe se o acesso é para uma pessoa maior ou menor de 18 anos.' });
  }
  const responsavel = validarResponsavel(req.body, null, faixaEtaria === 'MENOR');
  if (responsavel.erro) return res.status(400).json({ erro: responsavel.erro });
  if (!cpfIsValid(cpf, true) || !emailValido(email) || email.length > 160 || !senhaValida(senha)) {
    return res.status(400).json({ erro: 'Confira CPF, e-mail e senha (10 a 128 caracteres).' });
  }

  const senhaHash = await bcrypt.hash(senha, 12);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['sgcp_cpf_' + cpf]);
    const { rows: emailExistente } = await client.query('SELECT 1 FROM usuarios WHERE lower(email) = $1 LIMIT 1', [email]);
    if (emailExistente.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Este e-mail já possui uma conta.' });
    }
    const { rows: existentes } = await client.query(
      'SELECT id, nome, data_nascimento, cadastro_completo FROM pacientes WHERE cpf = $1 FOR UPDATE',
      [cpf]
    );
    const convite = texto(req.body?.convite);
    let paciente = existentes[0];
    if (paciente) {
      // CPF/e-mail não liberam um prontuário sem o convite conferido pela clínica.
      const hash = crypto.createHash('sha256').update(convite).digest('hex');
      const vinculo = convite.length === 43 ? await client.query(
        'SELECT 1 FROM convites_portal WHERE paciente_id = $1 AND token_hash = $2 AND usado_em IS NULL AND expira_em > CURRENT_TIMESTAMP FOR UPDATE',
        [paciente.id, hash]
      ) : { rowCount: 0 };
      const contaExistente = await client.query('SELECT 1 FROM usuarios WHERE paciente_id = $1', [paciente.id]);
      if (!vinculo.rowCount || contaExistente.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ erro: 'Entre com sua conta ou peça à clínica um convite válido para vincular seu cadastro.' });
      }
      if (menorDeIdade(paciente.data_nascimento) && faixaEtaria !== 'MENOR') {
        await client.query('ROLLBACK');
        return res.status(400).json({ erro: 'Este cadastro é de menor de idade e exige autorização da mãe ou do pai.' });
      }
      await client.query('UPDATE convites_portal SET usado_em = CURRENT_TIMESTAMP WHERE paciente_id = $1', [paciente.id]);
      await client.query('UPDATE pacientes SET email = $1, menor_declarado = $2 WHERE id = $3', [email, faixaEtaria === 'MENOR', paciente.id]);
    } else {
      if (convite) { await client.query('ROLLBACK'); return res.status(400).json({ erro: 'O convite não corresponde ao CPF informado. Confira os dados com a clínica.' }); }
      const { rows: pacientes } = await client.query(
        "INSERT INTO pacientes (nome, cpf, email, cadastro_completo, menor_declarado) VALUES ('Paciente', $1, $2, FALSE, $3) RETURNING id, nome",
        [cpf, email, faixaEtaria === 'MENOR']
      );
      paciente = pacientes[0];
    }
    const { rows: conta } = await client.query(
      "INSERT INTO usuarios (nome, email, senha_hash, perfil, paciente_id) VALUES ($1, $2, $3, 'PACIENTE', $4) RETURNING id, nome, email, perfil, paciente_id",
      [paciente.nome, email, senhaHash, paciente.id]
    );
    await registrarAceites(client, paciente.id, 'PORTAL', conta[0].id);
    await registrarConsentimentoResponsavel(client, paciente.id, responsavel.dados, 'PORTAL', conta[0].id);
    await client.query('COMMIT');
    setSessionCookie(res, conta[0].id, false);
    res.status(201).json({ usuario: usuarioSeguro(conta[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ erro: error.constraint === 'pacientes_cpf_key' ? 'Este CPF já está cadastrado.' : 'Este e-mail já possui uma conta.' });
    }
    next(error);
  } finally {
    client.release();
  }
});

const tentativasLogin = new Map();
const JANELA_LOGIN_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS_LOGIN = 10;

function loginLimitado(ip) {
  const agora = Date.now();
  const recentes = (tentativasLogin.get(ip) || []).filter((momento) => agora - momento < JANELA_LOGIN_MS);
  if (recentes.length >= MAX_TENTATIVAS_LOGIN) return false;
  recentes.push(agora);
  tentativasLogin.set(ip, recentes);
  if (tentativasLogin.size > 1000) {
    for (const [key, momentos] of tentativasLogin) {
      if (!momentos.length || agora - momentos[momentos.length - 1] >= JANELA_LOGIN_MS) tentativasLogin.delete(key);
    }
  }
  return true;
}

router.post('/login', async (req, res, next) => {
  const identificador = texto(req.body?.identificador ?? req.body?.email).toLowerCase();
  const porEmail = emailValido(identificador);
  const cpf = /^[\d.\-\s]+$/.test(identificador) ? digits(identificador) : '';
  const senha = req.body?.senha;
  if (!loginLimitado(req.ip)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
  if ((!porEmail && !cpfIsValid(cpf, true)) || typeof senha !== 'string' || !senha.length || senha.length > 128) {
    return res.status(400).json({ erro: 'Informe e-mail ou CPF e sua senha.' });
  }
  try {
    const { rows } = await db.query(
      'SELECT u.id, u.nome, u.email, u.senha_hash, u.perfil, u.paciente_id, u.ativo FROM usuarios u ' +
      'LEFT JOIN pacientes p ON p.id = u.paciente_id WHERE ' + (porEmail ? 'lower(u.email) = $1' : "p.cpf = $1 AND u.perfil = 'PACIENTE'") + ' LIMIT 1',
      [porEmail ? identificador : cpf]
    );
    const user = rows[0];
    if (!user || !user.ativo || !(await bcrypt.compare(senha, user.senha_hash))) {
      return res.status(401).json({ erro: 'Dados de acesso incorretos.' });
    }
    setSessionCookie(res, user.id, req.body?.manterConectado === true);
    res.json({ usuario: usuarioSeguro(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    if (req.user.perfil !== 'PACIENTE') return res.json({ usuario: req.user });
    const { rows } = await db.query(
      'SELECT id, nome, cpf, data_nascimento, telefone, email, endereco, cadastro_completo, menor_declarado FROM pacientes WHERE id = $1',
      [req.user.pacienteId]
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Cadastro do paciente não encontrado.' });
    res.json({ usuario: req.user, paciente: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.put('/perfil', requireAuth, async (req, res, next) => {
  const nome = texto(req.body?.nome);
  const email = texto(req.body?.email).toLowerCase();
  const telefone = texto(req.body?.telefone);
  const endereco = texto(req.body?.endereco) || null;
  const nascimento = texto(req.body?.nascimento) || null;
  if (nome.length < 3 || !emailValido(email) || (telefone && digits(telefone).length < 10) ||
      (req.user.perfil === 'PACIENTE' && !nascimento) || (nascimento && !validarNascimento(nascimento))) {
    return res.status(400).json({ erro: 'Confira nome, e-mail, celular e data de nascimento.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: duplicado } = await client.query(
      'SELECT 1 FROM usuarios WHERE lower(email) = $1 AND id <> $2 LIMIT 1',
      [email, req.user.id]
    );
    if (duplicado.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Este e-mail já pertence a outra conta.' });
    }
    if (req.user.perfil === 'PACIENTE') {
      const atual = (await client.query('SELECT cpf, data_nascimento, menor_declarado FROM pacientes WHERE id = $1 FOR UPDATE', [req.user.pacienteId])).rows[0];
      if (!atual) { await client.query('ROLLBACK'); return res.status(404).json({ erro: 'Paciente não encontrado.' }); }
      const responsavel = validarResponsavel({ ...req.body, cpf: atual.cpf }, nascimento, atual.menor_declarado === true);
      if (responsavel.erro) { await client.query('ROLLBACK'); return res.status(400).json({ erro: responsavel.erro }); }
      if (atual.menor_declarado === true && !menorDeIdade(nascimento)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ erro: 'A data diverge da declaração de menor de idade. Fale com a clínica para confirmar os dados.' });
      }
      if (atual?.data_nascimento && atual.data_nascimento !== nascimento) {
        await client.query('ROLLBACK');
        return res.status(409).json({ erro: 'Para corrigir a data de nascimento, fale com a clínica.' });
      }
      await registrarConsentimentoResponsavel(client, req.user.pacienteId, responsavel.dados, 'PORTAL', req.user.id);
    }
    await client.query('UPDATE usuarios SET nome = $1, email = $2 WHERE id = $3', [nome, email, req.user.id]);
    if (req.user.perfil === 'PACIENTE') {
      await client.query(
        'UPDATE pacientes SET nome = $1, email = $2, telefone = $3, endereco = $4, data_nascimento = $5, cadastro_completo = TRUE WHERE id = $6',
        [nome, email, telefone || null, endereco, nascimento, req.user.pacienteId]
      );
    }
    await client.query('COMMIT');
    const { rows } = await db.query('SELECT id, nome, email, perfil, paciente_id FROM usuarios WHERE id = $1', [req.user.id]);
    res.json({ usuario: usuarioSeguro(rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

router.post('/descadastro', requireAuth, async (req, res, next) => {
  if (req.user.perfil !== 'PACIENTE') {
    return res.status(403).json({ erro: 'Esta opção está disponível apenas para contas de pacientes.' });
  }
  try {
    await db.query(
      "UPDATE usuarios SET ativo = FALSE, descadastrado_em = CURRENT_TIMESTAMP WHERE id = $1 AND perfil = 'PACIENTE'",
      [req.user.id]
    );
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
