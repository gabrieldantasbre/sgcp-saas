const assert = require('node:assert/strict');
const vm = require('node:vm');
const { publicBranding } = require('../lib/branding');

module.exports = async function verifyBranding(url) {
  const defaults = publicBranding({});
  assert.equal(defaults.productName, 'SGCP');
  assert.equal(defaults.whatsapp, '');
  assert.equal(defaults.contactEmail, '');
  assert.equal(publicBranding({ CLINIC_WHATSAPP: '+55 (11) 99999-9999' }).whatsapp, '5511999999999');
  assert.equal(publicBranding({ CLINIC_WHATSAPP: '123', CLINIC_CONTACT_EMAIL: 'mailto:inválido' }).whatsapp, '');
  assert.equal(publicBranding({ CLINIC_CONTACT_EMAIL: 'mailto:inválido' }).contactEmail, '');
  assert.equal(publicBranding({ CLINIC_CONTACT_EMAIL: 'contato@example.invalid' }).contactEmail, 'contato@example.invalid');

  const keys = ['APP_NAME', 'CLINIC_NAME', 'CLINIC_WHATSAPP', 'CLINIC_CONTACT_EMAIL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.APP_NAME = 'Produto de teste';
    process.env.CLINIC_NAME = 'Clínica </script><script>throw 1</script> & teste';
    process.env.CLINIC_WHATSAPP = '';
    process.env.CLINIC_CONTACT_EMAIL = 'contato@example.invalid';
    const response = await fetch(url + '/config.js');
    assert.equal(response.status, 200);
    assert(response.headers.get('content-type').startsWith('application/javascript'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const script = await response.text();
    assert(!script.includes('</script>'));
    const context = { window: {} };
    vm.runInNewContext(script, context, { timeout: 1000 });
    const config = context.window.sgcpConfig;
    assert.equal(config.clinicName, process.env.CLINIC_NAME);
    assert.equal(config.productName, 'Produto de teste');
    assert.equal(config.contactEmail, 'contato@example.invalid');
    assert(Object.isFrozen(config));
    assert.deepEqual(Object.keys(config).sort(), ['address', 'clinicName', 'contactEmail', 'productName', 'professionalName', 'whatsapp']);
    assert(!('DB_PASSWORD' in config));
    assert(!('JWT_SECRET' in config));
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  console.log('OK: identidade configurável, contatos opcionais e configuração pública sem segredos.');
};
