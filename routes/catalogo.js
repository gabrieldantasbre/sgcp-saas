const router = require('express').Router();
const db = require('../db');
const { allowRoles, requireAuth, requireSameOrigin } = require('../lib/auth');

const somentePodologa = [requireAuth, allowRoles('PODOLOGA')];

function validarProcedimento(body) {
  const nome = String(body?.nome || '').trim();
  const descricao = String(body?.descricao || '').trim() || null;
  const valor = Number(body?.valorReferencia ?? body?.valor_referencia ?? 0);
  const duracao = Number(body?.duracaoMin ?? body?.duracao_media_min ?? 60);
  if (nome.length < 3 || nome.length > 120) return { erro: 'Informe um nome de 3 a 120 caracteres.' };
  if (descricao && descricao.length > 2000) return { erro: 'A descrição deve ter no máximo 2.000 caracteres.' };
  if (!Number.isFinite(valor) || valor < 0 || valor > 1000000) return { erro: 'Informe um preço válido.' };
  if (!Number.isInteger(duracao) || duracao < 1 || duracao > 240) return { erro: 'A duração deve ficar entre 1 e 240 minutos.' };
  return { dados: { nome, descricao, valor, duracao } };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      "SELECT 'PROCEDIMENTO' AS tipo, id, nome, descricao, valor_referencia AS preco, duracao_media_min AS duracao, NULL::varchar AS unidade " +
      'FROM procedimentos WHERE ativo = TRUE ' +
      'ORDER BY tipo, nome'
    );
    res.json(rows.map((item) => ({ ...item, id: String(item.id) })));
  } catch (error) { next(error); }
});

router.get('/admin', ...somentePodologa, async (req, res, next) => {
  try {
    const procedimentos = await db.query('SELECT id, nome, descricao, valor_referencia AS preco, duracao_media_min AS duracao, ativo FROM procedimentos ORDER BY nome');
    res.json({ procedimentos: procedimentos.rows.map((item) => ({ ...item, id: String(item.id) })) });
  } catch (error) { next(error); }
});

router.post('/procedimentos', requireSameOrigin, ...somentePodologa, async (req, res, next) => {
  const { erro, dados } = validarProcedimento(req.body);
  if (erro) return res.status(400).json({ erro });
  try {
    const { rows } = await db.query(
      'INSERT INTO procedimentos (nome, descricao, valor_referencia, duracao_media_min, ativo) VALUES ($1, $2, $3, $4, TRUE) ' +
      'RETURNING id, nome, descricao, valor_referencia AS preco, duracao_media_min AS duracao, ativo',
      [dados.nome, dados.descricao, dados.valor, dados.duracao]
    );
    res.status(201).json({ ...rows[0], id: String(rows[0].id), tipo: 'PROCEDIMENTO' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ erro: 'Já existe um procedimento com esse nome.' });
    next(error);
  }
});

router.put('/procedimentos/:id', requireSameOrigin, ...somentePodologa, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const { erro, dados } = validarProcedimento(req.body);
  if (erro) return res.status(400).json({ erro });
  try {
    const { rows } = await db.query(
      'UPDATE procedimentos SET nome = $1, descricao = $2, valor_referencia = $3, duracao_media_min = $4 WHERE id = $5 ' +
      'RETURNING id, nome, descricao, valor_referencia AS preco, duracao_media_min AS duracao, ativo',
      [dados.nome, dados.descricao, dados.valor, dados.duracao, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Procedimento não encontrado.' });
    res.json({ ...rows[0], id: String(rows[0].id), tipo: 'PROCEDIMENTO' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ erro: 'Já existe um procedimento com esse nome.' });
    next(error);
  }
});

router.patch('/procedimentos/:id/ativo', requireSameOrigin, ...somentePodologa, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id) || typeof req.body?.ativo !== 'boolean') return res.status(400).json({ erro: 'Informe um procedimento e uma situação válidos.' });
  try {
    const { rows } = await db.query('UPDATE procedimentos SET ativo = $1 WHERE id = $2 RETURNING id, ativo', [req.body.ativo, req.params.id]);
    if (!rows[0]) return res.status(404).json({ erro: 'Procedimento não encontrado.' });
    res.json({ ...rows[0], id: String(rows[0].id) });
  } catch (error) { next(error); }
});

module.exports = router;
