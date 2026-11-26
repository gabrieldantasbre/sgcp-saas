const router = require('express').Router();
const db = require('../db');
const { requireAuth, allowRoles } = require('../lib/auth');

router.get('/', requireAuth, allowRoles('PODOLOGA'), async (req, res, next) => {
  const termo = String(req.query.q || '').trim().slice(0, 100);
  const params = [];
  let filtro = '';
  if (termo) {
    params.push('%' + termo + '%');
    filtro = 'WHERE l.acao ILIKE $1 OR l.rota ILIKE $1 OR COALESCE(l.usuario_nome, u.nome, \'\') ILIKE $1';
  }
  try {
    const { rows } = await db.query(
      'SELECT l.id, l.usuario_id, COALESCE(l.usuario_nome, u.nome, \'Sessão não autenticada\') AS usuario_nome, ' +
      'l.acao, l.metodo, l.rota, l.status_http, l.criado_em ' +
      'FROM logs_sistema l LEFT JOIN usuarios u ON u.id = l.usuario_id ' + filtro +
      ' ORDER BY l.criado_em DESC, l.id DESC LIMIT 300',
      params
    );
    res.json(rows.map((item) => ({ ...item, id: String(item.id), usuario_id: item.usuario_id == null ? null : String(item.usuario_id) })));
  } catch (error) { next(error); }
});

module.exports = router;
