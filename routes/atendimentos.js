const router = require('express').Router();
const db = require('../db');
const { todayInSaoPaulo } = require('../lib/domain');
const { requireAuth, requirePermission, requireSameOrigin } = require('../lib/auth');

const podologa = [requireAuth, requirePermission('atendimento')];

function agoraDaClinica() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day') + ' ' +
    get('hour') + ':' + get('minute') + ':' + get('second');
}

router.get('/', ...podologa, async (req, res, next) => {
  try {
    const params = [];
    let filtro = '';
    if (req.query.pacienteId && /^\d+$/.test(String(req.query.pacienteId))) {
      params.push(String(req.query.pacienteId));
      filtro = 'WHERE a.paciente_id = $1';
    }
    const sql = [
      'SELECT a.id, a.paciente_id, p.nome AS paciente_nome, a.agendamento_id,',
      'a.podologa_id, a.inicio, a.fim, a.valor_final, a.status, a.queixa, a.evolucao, a.orientacoes,',
      "COALESCE(string_agg(pr.nome, ', ' ORDER BY pr.nome), '') AS procedimentos",
      'FROM atendimentos a JOIN pacientes p ON p.id = a.paciente_id',
      'LEFT JOIN itens_atendimento i ON i.atendimento_id = a.id',
      'LEFT JOIN procedimentos pr ON pr.id = i.procedimento_id',
      filtro,
      'GROUP BY a.id, p.nome ORDER BY a.inicio DESC LIMIT 500',
    ].filter(Boolean).join(' ');
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/', requireSameOrigin, ...podologa, async (req, res, next) => {
  const pacienteId = String(req.body?.pacienteId || '');
  const agendamentoId = String(req.body?.agendamentoId || '') || null;
  const procedimentoId = String(req.body?.procedimentoId || '');
  const valorFinal = Number(req.body?.valorFinal);
  const queixa = String(req.body?.queixa || '').trim();
  const evolucao = String(req.body?.evolucao || '').trim();
  const orientacoes = String(req.body?.orientacoes || '').trim();
  if (!/^\d+$/.test(pacienteId) || !/^\d+$/.test(procedimentoId) ||
      (agendamentoId && !/^\d+$/.test(agendamentoId))) {
    return res.status(400).json({ erro: 'Selecione um paciente, um procedimento e, se houver, um agendamento válido.' });
  }
  if (!Number.isFinite(valorFinal) || valorFinal < 0 || valorFinal > 100000) {
    return res.status(400).json({ erro: 'Informe um valor final válido.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: paciente } = await client.query('SELECT id FROM pacientes WHERE id = $1', [pacienteId]);
    if (!paciente[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Paciente não encontrado.' });
    }
    const { rows: procedimento } = await client.query(
      'SELECT id, nome FROM procedimentos WHERE id = $1',
      [procedimentoId]
    );
    if (!procedimento[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Procedimento não encontrado.' });
    }
    if (agendamentoId) {
      const { rows: agendamento } = await client.query(
        'SELECT id, paciente_id, status FROM agendamentos WHERE id = $1 FOR UPDATE',
        [agendamentoId]
      );
      if (!agendamento[0] || String(agendamento[0].paciente_id) !== pacienteId) {
        await client.query('ROLLBACK');
        return res.status(404).json({ erro: 'Agendamento não encontrado para este paciente.' });
      }
      if (!['AGENDADO', 'CONFIRMADO'].includes(agendamento[0].status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ erro: 'Este agendamento já foi finalizado ou cancelado.' });
      }
    }

    const instante = agoraDaClinica();
    const { rows: atendimento } = await client.query(
      'INSERT INTO atendimentos (agendamento_id, podologa_id, inicio, fim, valor_final, status, paciente_id, queixa, evolucao, orientacoes) ' +
      "VALUES ($1, $2, $3, $3, $4, 'CONCLUIDO', $5, $6, $7, $8) " +
      'RETURNING id, paciente_id, agendamento_id, inicio, fim, valor_final, status',
      [agendamentoId, req.user.id, instante, valorFinal, pacienteId, queixa || null, evolucao || null, orientacoes || null]
    );
    await client.query(
      'INSERT INTO itens_atendimento (atendimento_id, procedimento_id, quantidade, valor_cobrado) VALUES ($1, $2, 1, $3)',
      [atendimento[0].id, procedimentoId, valorFinal]
    );
    if (agendamentoId) {
      await client.query("UPDATE agendamentos SET status = 'CONCLUIDO' WHERE id = $1", [agendamentoId]);
    }
    if (valorFinal > 0) {
      await client.query(
        "INSERT INTO movimentacoes_financeiras (tipo, valor, data, descricao, atendimento_id, paciente_id, categoria, status) " +
        "VALUES ('RECEITA', $1, $2, $3, $4, $5, 'Atendimento', 'PENDENTE')",
        [valorFinal, todayInSaoPaulo(), 'Atendimento: ' + procedimento[0].nome, atendimento[0].id, pacienteId]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ ...atendimento[0], procedimento_nome: procedimento[0].nome, receita: valorFinal > 0 ? 'PENDENTE' : null });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ erro: 'Este agendamento já possui atendimento registrado.' });
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
