const { digits, cpfIsValid, isValidDate, todayInSaoPaulo } = require('./domain');

function menorDeIdade(nascimento, hoje = todayInSaoPaulo()) {
  if (!isValidDate(nascimento)) return false;
  const [ano, mes, dia] = nascimento.split('-').map(Number);
  const [anoAtual, mesAtual, diaAtual] = hoje.split('-').map(Number);
  const idade = anoAtual - ano - (mesAtual < mes || (mesAtual === mes && diaAtual < dia) ? 1 : 0);
  return idade < 18;
}

function validarResponsavel(body, nascimento, menorDeclarado = false) {
  if (!menorDeclarado && !menorDeIdade(nascimento)) return { dados: null };
  const nome = String(body?.responsavelNome ?? '').trim();
  const cpf = digits(body?.responsavelCpf);
  const vinculo = body?.responsavelVinculo;
  if (nome.length < 3 || nome.length > 120 || !cpfIsValid(cpf, true) || cpf === digits(body?.cpf) ||
      !['MAE', 'PAI'].includes(vinculo) || body?.consentimentoResponsavel !== true) {
    return { erro: 'Para menores de 18 anos, a mãe ou o pai deve informar nome, CPF próprio, vínculo e autorização específica.' };
  }
  return { dados: { nome, cpf, vinculo } };
}

async function registrarConsentimentoResponsavel(client, pacienteId, responsavel, origem, usuarioId = null) {
  if (!responsavel) return;
  await client.query(
    'INSERT INTO consentimentos_responsaveis (paciente_id, responsavel_nome, responsavel_cpf, origem, registrado_por, vinculo, versao, finalidade) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [pacienteId, responsavel.nome, responsavel.cpf, origem, usuarioId, responsavel.vinculo, '2026-11-v2',
      'Autorizo o cadastro ou atualização dos dados do menor e o tratamento necessário para acesso ao portal e organização do atendimento, conforme o Aviso de Privacidade 2026-11-v4.']
  );
}

module.exports = { menorDeIdade, validarResponsavel, registrarConsentimentoResponsavel };
