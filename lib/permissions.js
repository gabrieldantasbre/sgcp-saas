const PERMISSIONS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'agenda', label: 'Agenda e agendamentos' },
  { key: 'pacientes', label: 'Cadastro de pacientes' },
  { key: 'atendimento', label: 'Atendimento e prontuário' },
  { key: 'receitas', label: 'Receitas e recebimentos' },
  { key: 'despesas', label: 'Despesas e contas a pagar' },
  { key: 'estoque', label: 'Estoque e movimentações' },
  { key: 'relatorio_estoque', label: 'Relatório de estoque' },
  { key: 'relatorio_financeiro', label: 'Relatório financeiro' },
];

const PERMISSION_KEYS = new Set(PERMISSIONS.map((permission) => permission.key));

function normalizePermissions(value) {
  if (!Array.isArray(value)) return null;
  const permissions = [...new Set(value)];
  if (permissions.some((permission) => typeof permission !== 'string' || !PERMISSION_KEYS.has(permission))) return null;
  return permissions;
}

module.exports = { PERMISSIONS, normalizePermissions };
