const router = require('express').Router();
const db = require('../db');
const { requireAuth, requirePermission } = require('../lib/auth');

router.get('/', requireAuth, requirePermission('dashboard'), async (req, res, next) => {
  try {
    const sql = [
      'SELECT',
      "(SELECT COUNT(*) FROM agendamentos WHERE data_hora >= CURRENT_DATE AND data_hora < CURRENT_DATE + INTERVAL '1 day' AND status NOT IN ('CANCELADO', 'FALTOU')) AS consultas_hoje,",
      "(SELECT COUNT(*) FROM agendamentos WHERE status = 'AGENDADO' AND data_hora >= CURRENT_DATE) AS aguardando_confirmacao,",
      "(SELECT COUNT(*) FROM agendamentos WHERE origem = 'ONLINE' AND data_hora >= CURRENT_DATE AND data_hora < CURRENT_DATE + INTERVAL '7 days' AND status NOT IN ('CANCELADO', 'FALTOU')) AS online_7_dias,",
      '(SELECT COUNT(*) FROM pacientes) AS pacientes,',
      '(SELECT COUNT(*) FROM produtos WHERE ativo AND quantidade_atual <= estoque_minimo) AS itens_repor,',
      "(SELECT COUNT(*) FROM movimentacoes_financeiras WHERE tipo = 'RECEITA' AND status = 'PENDENTE') AS receitas_pendentes",
    ].join(' ');
    const { rows: base } = await db.query(sql);
    const cards = { ...base[0] };
    if (req.user.perfil === 'PODOLOGA' || req.user.permissoes.includes('agenda')) {
      const { rows } = await db.query(
        "WITH dias AS (SELECT generate_series((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date - 6, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date, INTERVAL '1 day')::date AS dia) " +
        "SELECT to_char(d.dia, 'YYYY-MM-DD') AS data, COUNT(a.id)::int AS total FROM dias d LEFT JOIN agendamentos a ON a.data_hora >= d.dia AND a.data_hora < d.dia + INTERVAL '1 day' AND a.status NOT IN ('CANCELADO', 'FALTOU') GROUP BY d.dia ORDER BY d.dia"
      );
      cards.atividade = rows;
    }
    if (req.user.perfil === 'PODOLOGA') {
      const { rows } = await db.query(
        "SELECT COALESCE(SUM(valor) FILTER (WHERE tipo = 'RECEITA' AND status = 'PAGO' AND data_pagamento = CURRENT_DATE), 0) AS recebido_hoje, " +
        "COALESCE(SUM(valor) FILTER (WHERE tipo = 'RECEITA' AND status = 'PENDENTE'), 0) AS a_receber " +
        'FROM movimentacoes_financeiras'
      );
      cards.financeiro = rows[0];
    }
    res.json(cards);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
