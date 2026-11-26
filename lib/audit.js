const db = require('../db');

function auditMutations(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const rota = String(req.originalUrl || req.path).split('?')[0].slice(0, 200);
  res.once('finish', () => {
    const usuarioId = req.user?.id || null;
    const usuarioNome = req.user?.nome || null;
    const acao = req.method + ' ' + rota;
    db.query(
      'INSERT INTO logs_sistema (usuario_id, usuario_nome, acao, metodo, rota, status_http) VALUES ($1, $2, $3, $4, $5, $6)',
      [usuarioId, usuarioNome, acao, req.method, rota, res.statusCode]
    ).catch((error) => console.error('Falha ao registrar log do sistema:', error.code || error.name));
  });
  next();
}

module.exports = { auditMutations };
