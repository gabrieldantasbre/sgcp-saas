const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../lib/auth');

router.get('/', requireAuth, async (req, res, next) => {
  const termo = String(req.query.q || '').trim().slice(0, 100);
  if (termo.length < 2) return res.json({ resultados: [] });
  const podeVerPacientes = req.user.perfil === 'PODOLOGA' || req.user.permissoes.includes('pacientes');
  const podeVerAgenda = req.user.perfil === 'PODOLOGA' || req.user.permissoes.includes('agenda');
  const podeVerAtendimento = req.user.perfil === 'PODOLOGA' || req.user.permissoes.includes('atendimento');
  const like = '%' + termo + '%';
  const cpf = termo.replace(/\D/g, '');
  try {
    const resultados = [];
    const consultas = [];
    if (podeVerPacientes) {
      consultas.push(db.query(
        'SELECT id, nome FROM pacientes WHERE nome ILIKE $1 OR email ILIKE $1 OR ($2 <> \'\' AND cpf LIKE $3) ORDER BY nome LIMIT 5',
        [like, cpf, '%' + cpf + '%']
      ).then(({ rows }) => rows.map((item) => ({ tipo: 'paciente', id: String(item.id), titulo: item.nome, detalhe: 'Abrir ficha do paciente' }))));
    }
    if (podeVerAgenda) {
      consultas.push(db.query(
        "SELECT a.id, a.paciente_id, p.nome AS paciente_nome, pr.nome AS procedimento_nome, to_char(a.data_hora, 'YYYY-MM-DD') AS data, to_char(a.data_hora, 'HH24:MI') AS hora " +
        'FROM agendamentos a JOIN pacientes p ON p.id = a.paciente_id LEFT JOIN procedimentos pr ON pr.id = a.procedimento_id ' +
        'WHERE p.nome ILIKE $1 OR pr.nome ILIKE $1 ORDER BY a.data_hora DESC LIMIT 5',
        [like]
      ).then(({ rows }) => rows.map((item) => ({ tipo: 'consulta', id: String(item.id), pacienteId: String(item.paciente_id), data: item.data, hora: item.hora, titulo: item.paciente_nome, detalhe: (item.procedimento_nome || 'Consulta') + ' · ' + item.data + ' ' + item.hora }))));
    }
    if (podeVerAgenda || podeVerAtendimento) {
      consultas.push(db.query(
        'SELECT id, nome FROM procedimentos WHERE nome ILIKE $1 ORDER BY nome LIMIT 4',
        [like]
      ).then(({ rows }) => rows.map((item) => ({ tipo: 'procedimento', id: String(item.id), titulo: item.nome, detalhe: 'Serviço da clínica' }))));

    }
    for (const lote of await Promise.all(consultas)) resultados.push(...lote);
    res.json({ resultados: resultados.slice(0, 15) });
  } catch (error) { next(error); }
});

module.exports = router;
