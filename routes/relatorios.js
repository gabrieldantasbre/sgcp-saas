const router = require('express').Router();
const db = require('../db');
const { isValidDate, todayInSaoPaulo } = require('../lib/domain');
const { requireAuth, requirePermission } = require('../lib/auth');

router.get('/financeiro', requireAuth, requirePermission('relatorio_financeiro'), async (req, res, next) => {
  const ate = String(req.query.ate || todayInSaoPaulo());
  const padraoDe = new Date(new Date(ate + 'T12:00:00Z').getTime() - 5 * 30 * 86400000).toISOString().slice(0, 10);
  const de = String(req.query.de || padraoDe);
  if (!isValidDate(de) || !isValidDate(ate) || de > ate) return res.status(400).json({ erro: 'Informe um período válido.' });
  try {
    const sql = [
      'SELECT',
      "COALESCE((SELECT SUM(valor) FROM movimentacoes_financeiras WHERE tipo = 'RECEITA' AND status = 'PAGO' AND data_pagamento BETWEEN $1 AND $2), 0) AS recebido,",
      "COALESCE((SELECT SUM(valor) FROM movimentacoes_financeiras WHERE tipo = 'DESPESA' AND status = 'PAGO' AND data_pagamento BETWEEN $1 AND $2), 0) AS despesas_pagas,",
      "COALESCE((SELECT SUM(valor) FROM movimentacoes_financeiras WHERE tipo = 'RECEITA' AND status = 'PENDENTE' AND data = $2), 0) AS a_receber_hoje,",
      "COALESCE((SELECT SUM(valor) FROM contas_pagar WHERE status = 'PENDENTE' AND vencimento = $2), 0) AS a_pagar_hoje,",
      "COALESCE((SELECT SUM(valor) FROM contas_pagar WHERE status = 'PENDENTE' AND vencimento < $2), 0) AS vencido",
    ].join(' ');
    const { rows: resumo } = await db.query(sql, [de, ate]);
    const { rows: meses } = await db.query(
      'SELECT mes, receitas AS recebido, despesas AS pago, saldo FROM vw_resumo_financeiro_mensal ' +
      'WHERE mes >= date_trunc(\'month\', $1::date)::date AND mes <= date_trunc(\'month\', $2::date)::date ORDER BY mes',
      [de, ate]
    );
    res.json({ periodo: { de, ate }, resumo: resumo[0], meses });
  } catch (error) {
    next(error);
  }
});

router.get('/estoque', requireAuth, requirePermission('relatorio_estoque'), async (req, res, next) => {
  const dias = Number(req.query.dias || 30);
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) return res.status(400).json({ erro: 'O período deve ser de 1 a 365 dias.' });
  try {
    const { rows: produtos } = await db.query(
      'SELECT p.id AS produto_id, p.nome, p.unidade_medida, p.quantidade_atual, p.estoque_minimo, ' +
      "CASE WHEN p.quantidade_atual <= p.estoque_minimo THEN 'Repor' ELSE 'OK' END AS situacao, " +
      "COALESCE(SUM(m.quantidade) FILTER (WHERE m.tipo = 'ENTRADA'), 0) AS entradas, " +
      "COALESCE(SUM(m.quantidade) FILTER (WHERE m.tipo = 'SAIDA'), 0) AS saidas " +
      'FROM produtos p LEFT JOIN movimentacoes_estoque m ON m.produto_id = p.id ' +
      'AND m.data_hora >= CURRENT_DATE - ($1::int * INTERVAL \'1 day\') ' +
      'WHERE p.ativo GROUP BY p.id ORDER BY situacao DESC, p.nome',
      [dias]
    );
    const { rows: movimentacoes } = await db.query(
      'SELECT m.id, p.nome AS produto_nome, m.tipo, m.quantidade, p.unidade_medida, m.data_hora, m.motivo, u.nome AS usuario_nome ' +
      'FROM movimentacoes_estoque m JOIN produtos p ON p.id = m.produto_id ' +
      'LEFT JOIN usuarios u ON u.id = m.registrado_por ' +
      'WHERE m.data_hora >= CURRENT_DATE - ($1::int * INTERVAL \'1 day\') ' +
      'ORDER BY m.data_hora DESC, m.id DESC LIMIT 1000',
      [dias]
    );
    const resumo = produtos.reduce((acc, item) => {
      acc.materiais++;
      if (item.situacao === 'Repor') acc.repor++;
      acc.entradas += Number(item.entradas);
      acc.saidas += Number(item.saidas);
      return acc;
    }, { materiais: 0, repor: 0, entradas: 0, saidas: 0 });
    res.json({ dias, resumo, produtos, movimentacoes });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
