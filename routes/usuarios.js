const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, allowRoles, requireSameOrigin } = require('../lib/auth');
const { PERMISSIONS, normalizePermissions } = require('../lib/permissions');

// A criação e a administração de contas permanecem restritas à proprietária.
const podologa = [requireAuth, allowRoles('PODOLOGA')];
const emailValido = (email) => /^\S+@\S+\.\S+$/.test(email);

router.get('/', ...podologa, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT u.id, u.nome, u.email, u.perfil, u.ativo, u.paciente_id, p.nome AS paciente_nome, pa.nome AS perfil_nome ' +
      'FROM usuarios u LEFT JOIN pacientes p ON p.id = u.paciente_id ' +
      'LEFT JOIN perfis_acesso pa ON pa.id = u.perfil_acesso_id ' +
      "ORDER BY CASE u.perfil WHEN 'PODOLOGA' THEN 1 WHEN 'RECEPCIONISTA' THEN 2 ELSE 3 END, u.nome"
    );
    res.json(rows.map((user) => ({
      id: String(user.id),
      nome: user.nome,
      email: user.email,
      perfil: user.perfil,
      perfilNome: user.perfil === 'PODOLOGA' ? 'Podóloga proprietária' :
        user.perfil === 'PACIENTE' ? 'Paciente' : (user.perfil_nome || 'Recepcionista'),
      ativo: user.ativo,
      pacienteId: user.paciente_id == null ? null : String(user.paciente_id),
      pacienteNome: user.paciente_nome,
    })));
  } catch (error) {
    next(error);
  }
});

router.get('/perfis', ...podologa, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT p.id, p.nome, p.permissoes, p.sistema, COUNT(u.id)::int AS usuarios ' +
      'FROM perfis_acesso p LEFT JOIN usuarios u ON u.perfil_acesso_id = p.id ' +
      'GROUP BY p.id ORDER BY p.sistema DESC, p.nome'
    );
    res.json({
      permissoesDisponiveis: PERMISSIONS,
      perfis: rows.map((profile) => ({
        id: String(profile.id),
        nome: profile.nome,
        permissoes: profile.permissoes,
        sistema: profile.sistema,
        usuarios: profile.usuarios,
      })),
    });
  } catch (error) {
    next(error);
  }
});

function validarPerfil(body) {
  const nome = String(body?.nome || '').trim();
  const permissoes = normalizePermissions(body?.permissoes);
  if (nome.length < 3 || nome.length > 60) return { erro: 'Informe um nome de perfil entre 3 e 60 caracteres.' };
  if (!permissoes || !permissoes.length) return { erro: 'Selecione pelo menos uma permissão válida.' };
  return { dados: { nome, permissoes } };
}

router.post('/perfis', requireSameOrigin, ...podologa, async (req, res, next) => {
  const { erro, dados } = validarPerfil(req.body || {});
  if (erro) return res.status(400).json({ erro });
  try {
    const { rows } = await db.query(
      'INSERT INTO perfis_acesso (nome, permissoes, criado_por) VALUES ($1, $2::jsonb, $3) ' +
      'RETURNING id, nome, permissoes, sistema',
      [dados.nome, JSON.stringify(dados.permissoes), req.user.id]
    );
    res.status(201).json({ ...rows[0], id: String(rows[0].id), usuarios: 0 });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ erro: 'Já existe um perfil com esse nome.' });
    next(error);
  }
});

router.put('/perfis/:id', requireSameOrigin, ...podologa, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const { erro, dados } = validarPerfil(req.body || {});
  if (erro) return res.status(400).json({ erro });
  try {
    const { rows } = await db.query(
      'UPDATE perfis_acesso SET nome = $1, permissoes = $2::jsonb WHERE id = $3 ' +
      'RETURNING id, nome, permissoes, sistema',
      [dados.nome, JSON.stringify(dados.permissoes), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Perfil não encontrado.' });
    res.json({ ...rows[0], id: String(rows[0].id) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ erro: 'Já existe um perfil com esse nome.' });
    next(error);
  }
});

router.delete('/perfis/:id', requireSameOrigin, ...podologa, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  try {
    const { rows } = await db.query('SELECT sistema FROM perfis_acesso WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ erro: 'Perfil não encontrado.' });
    if (rows[0].sistema) return res.status(409).json({ erro: 'O perfil padrão não pode ser removido.' });
    const { rows: usuarios } = await db.query('SELECT 1 FROM usuarios WHERE perfil_acesso_id = $1 LIMIT 1', [req.params.id]);
    if (usuarios.length) return res.status(409).json({ erro: 'Este perfil está atribuído a usuários. Altere o perfil deles antes de removê-lo.' });
    await db.query('DELETE FROM perfis_acesso WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post('/', requireSameOrigin, ...podologa, async (req, res, next) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = req.body?.senha;
  const perfilId = String(req.body?.perfilId || '');
  if (nome.length < 3 || nome.length > 120 || !emailValido(email) ||
      typeof senha !== 'string' || senha.length < 10 || senha.length > 128 || !/^\d+$/.test(perfilId)) {
    return res.status(400).json({ erro: 'Informe nome, e-mail, senha com ao menos 10 caracteres e um perfil válido.' });
  }
  try {
    const { rows: perfil } = await db.query('SELECT id FROM perfis_acesso WHERE id = $1', [perfilId]);
    if (!perfil[0]) return res.status(400).json({ erro: 'Selecione um perfil de acesso válido.' });
    const senhaHash = await bcrypt.hash(senha, 12);
    const { rows } = await db.query(
      "INSERT INTO usuarios (nome, email, senha_hash, perfil, perfil_acesso_id, ativo) " +
      "VALUES ($1, $2, $3, 'RECEPCIONISTA', $4, TRUE) RETURNING id, nome, email, perfil, perfil_acesso_id, ativo",
      [nome, email, senhaHash, perfilId]
    );
    res.status(201).json({ ...rows[0], id: String(rows[0].id) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ erro: 'Já existe uma conta com esse e-mail.' });
    next(error);
  }
});

router.patch('/:id/ativo', requireSameOrigin, ...podologa, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const ativo = req.body?.ativo;
  if (typeof ativo !== 'boolean') return res.status(400).json({ erro: 'Informe se a conta deve ficar ativa.' });
  if (req.params.id === req.user.id && !ativo) return res.status(400).json({ erro: 'Você não pode desativar a própria conta.' });
  try {
    const { rows } = await db.query(
      "UPDATE usuarios SET ativo = $1 WHERE id = $2 AND perfil <> 'PODOLOGA' RETURNING id, nome, email, perfil, ativo",
      [ativo, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Conta não encontrada ou não pode ser desativada por esta tela.' });
    res.json({ ...rows[0], id: String(rows[0].id) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
