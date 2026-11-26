// Cada versão corresponde ao texto publicado em public/termos.html e privacidade.html.
const VERSAO_TERMOS = '2026-11-v2';
const VERSAO_PRIVACIDADE = '2026-11-v4';

function validarAceites(body) {
  if (body?.aceitouTermos !== true || body?.versaoTermos !== VERSAO_TERMOS) {
    return 'Leia e aceite os Termos de Uso vigentes para continuar.';
  }
  if (body?.aceitouAvisoPrivacidade !== true) return 'Confirme que leu o Aviso de Privacidade.';
  return null;
}

async function registrarAceites(client, pacienteId, origem, usuarioId = null) {
  await client.query(
    'INSERT INTO aceites_termos (paciente_id, usuario_id, versao, origem) VALUES ($1, $2, $3, $4)',
    [pacienteId, usuarioId, VERSAO_TERMOS, origem]
  );
  // A primeira ciência de uma versão é preservada.
  await client.query(
    'INSERT INTO aceites_privacidade_paciente (paciente_id, versao) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [pacienteId, VERSAO_PRIVACIDADE]
  );
}

module.exports = { VERSAO_TERMOS, VERSAO_PRIVACIDADE, validarAceites, registrarAceites };
