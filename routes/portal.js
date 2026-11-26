const router = require('express').Router();
const db = require('../db');
const { requireAuth, allowRoles } = require('../lib/auth');

router.get('/ficha', requireAuth, allowRoles('PACIENTE'), async (req, res, next) => {
  try {
    const pacienteId = req.user.pacienteId;
    const [cadastro, consultas, saude, atendimentos, pagamentos] = await Promise.all([
      db.query(
        "SELECT id, nome, cpf, to_char(data_nascimento, 'YYYY-MM-DD') AS data_nascimento, telefone, email, endereco, " +
        "to_char(data_cadastro, 'YYYY-MM-DD') AS data_cadastro FROM pacientes WHERE id = $1",
        [pacienteId]
      ),
      db.query(
        "SELECT a.id, to_char(a.data_hora, 'YYYY-MM-DD') AS data, to_char(a.data_hora, 'HH24:MI') AS hora, " +
        'a.duracao_prevista_min, a.status, a.tipo, a.origem, a.observacao, pr.nome AS procedimento_nome ' +
        'FROM agendamentos a LEFT JOIN procedimentos pr ON pr.id = a.procedimento_id ' +
        'WHERE a.paciente_id = $1 ORDER BY a.data_hora DESC LIMIT 300',
        [pacienteId]
      ),
      db.query(
        "SELECT id, to_char(data_preenchimento, 'YYYY-MM-DD') AS data_preenchimento, queixa_principal, diabetico, " +
        'hipertenso, problema_circulatorio, alergias, medicamentos_em_uso, cirurgias_anteriores, tipo_calcado, observacoes ' +
        'FROM fichas_anamnese WHERE paciente_id = $1 ORDER BY data_preenchimento DESC, id DESC LIMIT 100',
        [pacienteId]
      ),
      db.query(
        "SELECT a.id, to_char(a.inicio, 'YYYY-MM-DD') AS data, to_char(a.inicio, 'HH24:MI') AS hora, " +
        'a.valor_final, a.status, a.queixa, a.evolucao, a.orientacoes, ' +
        "COALESCE(string_agg(pr.nome, ', ' ORDER BY pr.nome), '') AS procedimentos " +
        'FROM atendimentos a LEFT JOIN itens_atendimento i ON i.atendimento_id = a.id ' +
        'LEFT JOIN procedimentos pr ON pr.id = i.procedimento_id ' +
        'WHERE a.paciente_id = $1 GROUP BY a.id ORDER BY a.inicio DESC LIMIT 300',
        [pacienteId]
      ),
      db.query(
        "SELECT id, categoria, descricao, valor, status, to_char(data, 'YYYY-MM-DD') AS data, " +
        "to_char(data_pagamento, 'YYYY-MM-DD') AS data_pagamento, forma_pagamento " +
        "FROM movimentacoes_financeiras WHERE paciente_id = $1 AND tipo = 'RECEITA' " +
        'ORDER BY COALESCE(data_pagamento, data) DESC, id DESC LIMIT 300',
        [pacienteId]
      ),
    ]);

    if (!cadastro.rows[0]) return res.status(404).json({ erro: 'Seu cadastro de paciente não foi encontrado.' });
    res.json({
      cadastro: cadastro.rows[0],
      consultas: consultas.rows,
      saude: saude.rows,
      atendimentos: atendimentos.rows,
      pagamentos: pagamentos.rows,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
