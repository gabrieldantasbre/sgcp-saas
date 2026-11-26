const router = require('express').Router();
const db = require('../db');
const { requireAuth, requirePermission, requireSameOrigin } = require('../lib/auth');

const podologa = [requireAuth, requirePermission('atendimento')];
const texto = (value) => String(value ?? '').trim() || null;
const booleano = (value) => value === true || value === 'true' || value === 'on';

router.get('/:pacienteId', ...podologa, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.pacienteId)) return res.status(400).json({ erro: 'Identificador inválido.' });
  try {
    const sql = [
      'SELECT f.id, f.paciente_id, p.nome AS paciente_nome, f.podologa_id,',
      'u.nome AS podologa_nome, f.data_preenchimento, f.queixa_principal,',
      'f.diabetico, f.hipertenso, f.problema_circulatorio, f.alergias,',
      'f.medicamentos_em_uso, f.cirurgias_anteriores, f.tipo_calcado, f.observacoes',
      'FROM fichas_anamnese f JOIN pacientes p ON p.id = f.paciente_id',
      'LEFT JOIN usuarios u ON u.id = f.podologa_id',
      'WHERE f.paciente_id = $1 ORDER BY f.data_preenchimento DESC, f.id DESC',
    ].join(' ');
    const { rows } = await db.query(sql, [req.params.pacienteId]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/', requireSameOrigin, ...podologa, async (req, res, next) => {
  const pacienteId = String(req.body?.pacienteId || '');
  if (!/^\d+$/.test(pacienteId)) return res.status(400).json({ erro: 'Selecione o paciente.' });
  const dados = {
    queixa: texto(req.body?.queixaPrincipal),
    diabetico: booleano(req.body?.diabetico),
    hipertenso: booleano(req.body?.hipertenso),
    circulatorio: booleano(req.body?.problemaCirculatorio),
    alergias: texto(req.body?.alergias),
    medicamentos: texto(req.body?.medicamentos),
    cirurgias: texto(req.body?.cirurgias),
    calcado: texto(req.body?.tipoCalcado),
    observacoes: texto(req.body?.observacoes),
  };
  try {
    const { rows } = await db.query(
      'INSERT INTO fichas_anamnese (paciente_id, podologa_id, queixa_principal, diabetico, hipertenso, problema_circulatorio, alergias, medicamentos_em_uso, cirurgias_anteriores, tipo_calcado, observacoes) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ' +
      'RETURNING id, paciente_id, data_preenchimento, queixa_principal, diabetico, hipertenso, problema_circulatorio, alergias, medicamentos_em_uso, cirurgias_anteriores, tipo_calcado, observacoes',
      [
        pacienteId, req.user.id, dados.queixa, dados.diabetico, dados.hipertenso,
        dados.circulatorio, dados.alergias, dados.medicamentos, dados.cirurgias,
        dados.calcado, dados.observacoes,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23503') return res.status(404).json({ erro: 'Paciente não encontrado.' });
    next(error);
  }
});

module.exports = router;
