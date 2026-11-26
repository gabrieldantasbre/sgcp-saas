const router = require('express').Router();
const db = require('../db');
const { requireAuth, allowRoles, requireSameOrigin } = require('../lib/auth');

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, nome, descricao, valor_referencia, duracao_media_min, ativo FROM procedimentos WHERE ativo = TRUE ORDER BY nome'
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

function validar(body) {
  const nome = String(body.nome || '').trim();
  const valor = Number(body.valorReferencia ?? body.valor_referencia);
  const duracao = Number(body.duracaoMin ?? body.duracao_media_min ?? 60);
  if (nome.length < 3 || nome.length > 120) return { erro: 'Informe um nome de 3 a 120 caracteres.' };
  if (!Number.isFinite(valor) || valor < 0) return { erro: 'O valor de referência deve ser zero ou maior.' };
  if (!Number.isInteger(duracao) || duracao < 1 || duracao > 240) return { erro: 'A duração deve ficar entre 1 e 240 minutos.' };
  return {
    dados: {
      nome,
      descricao: String(body.descricao || '').trim() || null,
      valor,
      duracao,
    },
  };
}

router.post('/', requireSameOrigin, requireAuth, allowRoles('PODOLOGA'), async (req, res, next) => {
  const { erro, dados } = validar(req.body || {});
  if (erro) return res.status(400).json({ erro });
  try {
    const { rows } = await db.query(
      'INSERT INTO procedimentos (nome, descricao, valor_referencia, duracao_media_min, ativo) VALUES ($1, $2, $3, $4, TRUE) RETURNING id, nome, descricao, valor_referencia, duracao_media_min, ativo',
      [dados.nome, dados.descricao, dados.valor, dados.duracao]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ erro: 'Já existe um procedimento com esse nome.' });
    next(error);
  }
});

router.put('/:id', requireSameOrigin, requireAuth, allowRoles('PODOLOGA'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const { erro, dados } = validar(req.body || {});
  if (erro) return res.status(400).json({ erro });
  try {
    const { rows } = await db.query(
      'UPDATE procedimentos SET nome = $1, descricao = $2, valor_referencia = $3, duracao_media_min = $4 WHERE id = $5 AND ativo = TRUE RETURNING id, nome, descricao, valor_referencia, duracao_media_min, ativo',
      [dados.nome, dados.descricao, dados.valor, dados.duracao, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Procedimento não encontrado.' });
    res.json(rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ erro: 'Já existe um procedimento com esse nome.' });
    next(error);
  }
});

router.delete('/:id', requireSameOrigin, requireAuth, allowRoles('PODOLOGA'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  try {
    const { rowCount } = await db.query('UPDATE procedimentos SET ativo = FALSE WHERE id = $1 AND ativo = TRUE', [req.params.id]);
    if (!rowCount) return res.status(404).json({ erro: 'Procedimento não encontrado.' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
