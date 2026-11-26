const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const { isValidDate, todayInSaoPaulo } = require('../lib/domain');
const { requireAuth, requirePermission, requireSameOrigin } = require('../lib/auth');

const equipe = [requireAuth, requirePermission('receitas')];
const despesas = [requireAuth, requirePermission('despesas')];
const FORMAS_PAGAMENTO = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'BOLETO', 'TRANSFERENCIA'];
const CATEGORIAS_DESPESA = [
  'Aluguel', 'Salários e encargos', 'Materiais e insumos', 'Água, energia e internet',
  'Impostos e taxas', 'Serviços de terceiros', 'Equipamentos', 'Manutenção', 'Marketing', 'Outras despesas',
];
const CATEGORIAS_RECEITA = ['Atendimento', 'Venda de produto', 'Outras receitas'];
const hoje = todayInSaoPaulo;

router.get('/receitas', ...equipe, async (req, res, next) => {
  try {
    const status = String(req.query.status || '').toUpperCase();
    const params = [];
    let filtro = "WHERE f.tipo = 'RECEITA'";
    if (status && ['PENDENTE', 'PAGO'].includes(status)) {
      params.push(status);
      filtro += ' AND f.status = $' + params.length;
    }
    const { rows } = await db.query(
      'SELECT f.id, f.paciente_id, p.nome AS paciente_nome, f.atendimento_id, f.categoria, f.descricao, ' +
      'f.valor, f.forma_pagamento, f.status, f.data AS data_lancamento, f.data_pagamento ' +
      'FROM movimentacoes_financeiras f LEFT JOIN pacientes p ON p.id = f.paciente_id ' +
      filtro + ' ORDER BY COALESCE(f.data_pagamento, f.data) DESC, f.id DESC LIMIT 500',
      params
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/receitas', requireSameOrigin, ...equipe, async (req, res, next) => {
  const descricao = String(req.body?.descricao || '').trim();
  const categoria = String(req.body?.categoria || 'Outras receitas');
  const valor = Number(req.body?.valor);
  const pacienteId = req.body?.pacienteId ? String(req.body.pacienteId) : null;
  const status = String(req.body?.status || 'PENDENTE').toUpperCase();
  const forma = String(req.body?.formaPagamento || '').toUpperCase() || null;
  if (!descricao || descricao.length > 150 || !CATEGORIAS_RECEITA.includes(categoria) ||
      !Number.isFinite(valor) || valor <= 0 || valor > 1000000 ||
      (pacienteId && !/^\d+$/.test(pacienteId)) || !['PENDENTE', 'PAGO'].includes(status)) {
    return res.status(400).json({ erro: 'Confira descrição, categoria, valor, paciente e situação da receita.' });
  }
  if (status === 'PAGO' && (!FORMAS_PAGAMENTO.includes(forma) || (req.body?.dataPagamento && req.body.dataPagamento !== hoje()))) {
    return res.status(400).json({ erro: 'Para registrar uma receita paga, informe a forma de pagamento e a data de hoje.' });
  }
  try {
    const { rows } = await db.query(
      "INSERT INTO movimentacoes_financeiras (tipo, valor, data, descricao, forma_pagamento, paciente_id, categoria, status, data_pagamento) " +
      "VALUES ('RECEITA', $1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = 'PAGO' THEN $2::date ELSE NULL END) " +
      'RETURNING id, paciente_id, categoria, descricao, valor, forma_pagamento, status, data AS data_lancamento, data_pagamento',
      [valor, hoje(), descricao, forma, pacienteId, categoria, status]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch('/receitas/:id/pagar', requireSameOrigin, ...equipe, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const forma = String(req.body?.formaPagamento || '').toUpperCase();
  if (!FORMAS_PAGAMENTO.includes(forma)) return res.status(400).json({ erro: 'Selecione uma forma de pagamento válida.' });
  try {
    const { rows } = await db.query(
      "UPDATE movimentacoes_financeiras SET status = 'PAGO', data_pagamento = $1, forma_pagamento = $2 " +
      "WHERE id = $3 AND tipo = 'RECEITA' AND status = 'PENDENTE' " +
      'RETURNING id, paciente_id, atendimento_id, categoria, descricao, valor, forma_pagamento, status, data AS data_lancamento, data_pagamento',
      [hoje(), forma, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Receita pendente não encontrada.' });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get('/despesas', ...despesas, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      "SELECT id, descricao, categoria, fornecedor, valor, vencimento, data_pagamento, " +
      "CASE WHEN status = 'PENDENTE' AND vencimento < CURRENT_DATE THEN 'VENCIDA' ELSE status END AS status, " +
      'forma_pagamento, recorrencia, serie, parcela ' +
      'FROM contas_pagar ORDER BY CASE WHEN status = \'PENDENTE\' AND vencimento < CURRENT_DATE THEN 0 ELSE 1 END, vencimento, id LIMIT 500'
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

function adicionarMeses(iso, quantidade) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  const primeiro = new Date(Date.UTC(ano, mes - 1 + quantidade, 1));
  const ultimoDia = new Date(Date.UTC(primeiro.getUTCFullYear(), primeiro.getUTCMonth() + 1, 0)).getUTCDate();
  return primeiro.getUTCFullYear() + '-' + String(primeiro.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(Math.min(dia, ultimoDia)).padStart(2, '0');
}

router.post('/despesas', requireSameOrigin, ...despesas, async (req, res, next) => {
  const descricao = String(req.body?.descricao || '').trim();
  const categoria = String(req.body?.categoria || '');
  const fornecedor = String(req.body?.fornecedor || '').trim() || null;
  const valor = Number(req.body?.valor);
  const vencimento = String(req.body?.vencimento || '');
  const recorrencia = String(req.body?.recorrencia || 'nao').toLowerCase();
  const quantidadeParcelas = Number(req.body?.quantidadeParcelas || 1);
  if (!descricao || descricao.length > 150 || !CATEGORIAS_DESPESA.includes(categoria) ||
      fornecedor && fornecedor.length > 120 || !Number.isFinite(valor) || valor <= 0 ||
      !isValidDate(vencimento) || !['nao', 'mensal', 'parcelado'].includes(recorrencia)) {
    return res.status(400).json({ erro: 'Confira descrição, categoria, valor, vencimento e recorrência.' });
  }
  if (recorrencia === 'parcelado' && (!Number.isInteger(quantidadeParcelas) || quantidadeParcelas < 2 || quantidadeParcelas > 36)) {
    return res.status(400).json({ erro: 'Informe de 2 a 36 parcelas.' });
  }

  const serie = recorrencia === 'nao' ? null : crypto.randomUUID();
  const quantidade = recorrencia === 'parcelado' ? quantidadeParcelas : 1;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const criadas = [];
    for (let parcela = 1; parcela <= quantidade; parcela++) {
      const dataVencimento = adicionarMeses(vencimento, parcela - 1);
      const parcelaTexto = recorrencia === 'parcelado' ? parcela + '/' + quantidade : null;
      const { rows } = await client.query(
        "INSERT INTO contas_pagar (descricao, categoria, fornecedor, valor, vencimento, status, recorrencia, serie, parcela) " +
        "VALUES ($1, $2, $3, $4, $5, 'PENDENTE', $6, $7, $8) " +
        'RETURNING id, descricao, categoria, fornecedor, valor, vencimento, status, recorrencia, serie, parcela',
        [descricao, categoria, fornecedor, valor, dataVencimento, recorrencia, serie, parcelaTexto]
      );
      criadas.push(rows[0]);
    }
    await client.query('COMMIT');
    res.status(201).json(criadas);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

router.patch('/despesas/:id/pagar', requireSameOrigin, ...despesas, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
  const forma = String(req.body?.formaPagamento || '').toUpperCase();
  if (!FORMAS_PAGAMENTO.includes(forma)) return res.status(400).json({ erro: 'Selecione uma forma de pagamento válida.' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "SELECT id, descricao, categoria, fornecedor, valor, vencimento, recorrencia, serie, parcela FROM contas_pagar WHERE id = $1 AND status = 'PENDENTE' FOR UPDATE",
      [req.params.id]
    );
    const conta = rows[0];
    if (!conta) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Conta pendente não encontrada.' });
    }
    const dataPagamento = hoje();
    const { rows: paga } = await client.query(
      "UPDATE contas_pagar SET status = 'PAGA', data_pagamento = $1, forma_pagamento = $2 WHERE id = $3 RETURNING id, descricao, categoria, valor, vencimento, status, data_pagamento, forma_pagamento",
      [dataPagamento, forma, conta.id]
    );
    await client.query(
      "INSERT INTO movimentacoes_financeiras (tipo, valor, data, descricao, forma_pagamento, conta_pagar_id, categoria, status, data_pagamento) " +
      "VALUES ('DESPESA', $1, $2, $3, $4, $5, $6, 'PAGO', $2)",
      [conta.valor, dataPagamento, conta.descricao, forma, conta.id, conta.categoria]
    );

    let proxima = null;
    if (conta.recorrencia === 'mensal') {
      const proximoVencimento = adicionarMeses(conta.vencimento, 1);
      const { rows: existente } = await client.query('SELECT id FROM contas_pagar WHERE serie = $1 AND vencimento = $2 LIMIT 1', [conta.serie, proximoVencimento]);
      if (!existente[0]) {
        const { rows: criadas } = await client.query(
          "INSERT INTO contas_pagar (descricao, categoria, fornecedor, valor, vencimento, status, recorrencia, serie) " +
          "VALUES ($1, $2, $3, $4, $5, 'PENDENTE', 'mensal', $6) RETURNING id, descricao, categoria, fornecedor, valor, vencimento, status, recorrencia, serie",
          [conta.descricao, conta.categoria, conta.fornecedor, conta.valor, proximoVencimento, conta.serie]
        );
        proxima = criadas[0];
      }
    }
    await client.query('COMMIT');
    res.json({ despesa: paga[0], proximaConta: proxima });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
