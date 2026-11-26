const router = require('express').Router();
const db = require('../db');
const { requireAuth, requirePermission, requireSameOrigin } = require('../lib/auth');

const equipe = [requireAuth, requirePermission('estoque')];

router.get('/produtos', ...equipe, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, nome, unidade_medida, quantidade_atual, estoque_minimo, ativo ' +
      'FROM produtos WHERE ativo = TRUE ORDER BY nome'
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

function validarProduto(body) {
  const nome = String(body.nome || '').trim();
  const unidade = String(body.unidadeMedida ?? body.unidade_medida ?? 'un').trim() || 'un';
  const minimo = Number(body.estoqueMinimo ?? body.estoque_minimo ?? 0);
  if (nome.length < 2 || nome.length > 120) return { erro: 'Informe um nome de 2 a 120 caracteres.' };
  if (unidade.length > 20) return { erro: 'A unidade pode ter até 20 caracteres.' };
  if (!Number.isFinite(minimo) || minimo < 0) return { erro: 'O estoque mínimo deve ser zero ou maior.' };
  return { dados: { nome, unidade, minimo } };
}

router.post('/produtos', requireSameOrigin, ...equipe, async (req, res, next) => {
  const { erro, dados } = validarProduto(req.body || {});
  if (erro) return res.status(400).json({ erro });
  const quantidadeInicial = Number(req.body?.quantidadeInicial ?? req.body?.quantidade ?? 0);
  if (!Number.isFinite(quantidadeInicial) || quantidadeInicial < 0 || quantidadeInicial > 1000000) {
    return res.status(400).json({ erro: 'Informe uma quantidade inicial válida.' });
  }
  const motivo = String(req.body?.motivo || 'Saldo inicial').trim().slice(0, 150) || 'Saldo inicial';
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO produtos (nome, unidade_medida, quantidade_atual, estoque_minimo, ativo) VALUES ($1, $2, 0, $3, TRUE) RETURNING id, nome, unidade_medida, quantidade_atual, estoque_minimo, ativo',
      [dados.nome, dados.unidade, dados.minimo]
    );
    if (quantidadeInicial > 0) {
      await client.query(
        "INSERT INTO movimentacoes_estoque (produto_id, atendimento_id, registrado_por, tipo, quantidade, motivo) VALUES ($1, NULL, $2, 'ENTRADA', $3, $4)",
        [rows[0].id, req.user.id, quantidadeInicial, motivo]
      );
    }
    const atualizado = await client.query(
      'SELECT id, nome, unidade_medida, quantidade_atual, estoque_minimo, ativo FROM produtos WHERE id = $1',
      [rows[0].id]
    );
    await client.query('COMMIT');
    res.status(201).json(atualizado.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ erro: 'Já existe um material com esse nome.' });
    next(error);
  } finally {
    client.release();
  }
});

router.put('/produtos/:id', requireSameOrigin, ...equipe, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const { erro, dados } = validarProduto(req.body || {});
  if (erro) return res.status(400).json({ erro });
  try {
    const { rows } = await db.query(
      'UPDATE produtos SET nome = $1, unidade_medida = $2, estoque_minimo = $3 WHERE id = $4 AND ativo = TRUE RETURNING id, nome, unidade_medida, quantidade_atual, estoque_minimo, ativo',
      [dados.nome, dados.unidade, dados.minimo, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Material não encontrado.' });
    res.json(rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ erro: 'Já existe um material com esse nome.' });
    next(error);
  }
});

router.post('/movimentacoes', requireSameOrigin, ...equipe, async (req, res, next) => {
  const produtoId = String(req.body?.produtoId || '');
  const atendimentoId = req.body?.atendimentoId ? String(req.body.atendimentoId) : null;
  const tipo = String(req.body?.tipo || '').toUpperCase();
  const quantidade = Number(req.body?.quantidade);
  const motivo = String(req.body?.motivo || '').trim();
  if (!/^\d+$/.test(produtoId) || (atendimentoId && !/^\d+$/.test(atendimentoId)) ||
      !['ENTRADA', 'SAIDA'].includes(tipo) || !Number.isFinite(quantidade) || quantidade <= 0 ||
      quantidade > 1000000 || motivo.length > 150) {
    return res.status(400).json({ erro: 'Confira produto, tipo, quantidade, atendimento e motivo da movimentação.' });
  }
  try {
    const { rows } = await db.query(
      'INSERT INTO movimentacoes_estoque (produto_id, atendimento_id, registrado_por, tipo, quantidade, motivo) ' +
      'VALUES ($1, $2, $3, $4, $5, $6) ' +
      'RETURNING id, produto_id, atendimento_id, registrado_por, tipo, quantidade, data_hora, motivo',
      [produtoId, atendimentoId, req.user.id, tipo, quantidade, motivo || null]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23503') return res.status(404).json({ erro: 'Produto ou atendimento não encontrado.' });
    if (error.code === '23514') return res.status(409).json({ erro: 'A saída excede o saldo disponível no estoque.' });
    next(error);
  }
});

router.get('/movimentacoes', ...equipe, async (req, res, next) => {
  const dias = Number(req.query.dias || 30);
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) return res.status(400).json({ erro: 'O período deve ser de 1 a 365 dias.' });
  try {
    const { rows } = await db.query(
      'SELECT m.id, m.produto_id, p.nome AS produto_nome, m.atendimento_id, m.registrado_por, u.nome AS usuario_nome, ' +
      'm.tipo, m.quantidade, m.data_hora, m.motivo ' +
      'FROM movimentacoes_estoque m JOIN produtos p ON p.id = m.produto_id ' +
      'LEFT JOIN usuarios u ON u.id = m.registrado_por ' +
      'WHERE m.data_hora >= CURRENT_DATE - ($1::int * INTERVAL \'1 day\') ' +
      'ORDER BY m.data_hora DESC, m.id DESC LIMIT 1000',
      [dias]
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
