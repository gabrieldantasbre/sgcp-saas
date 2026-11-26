require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const db = require('./db');
const { auditMutations } = require('./lib/audit');
const { publicBranding } = require('./lib/branding');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.get('/config.js', (req, res) => {
  // Escape caracteres HTML, inclusive quando o nome contém texto digitado pelo operador.
  const config = JSON.stringify(publicBranding()).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/javascript').send('window.sgcpConfig = Object.freeze(' + config + ');');
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', auditMutations);

app.get('/api/health', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT current_database() AS banco, now() AS agora');
    res.json({ ok: true, ...rows[0] });
  } catch {
    res.status(503).json({ ok: false, erro: 'Banco de dados indisponível. Confira a conexão PostgreSQL.' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/portal', require('./routes/portal'));
app.use('/api/busca', require('./routes/busca'));
app.use('/api/catalogo', require('./routes/catalogo'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/pacientes', require('./routes/pacientes'));
app.use('/api/procedimentos', require('./routes/procedimentos'));
app.use('/api/agendamentos', require('./routes/agendamentos'));
app.use('/api/anamneses', require('./routes/anamneses'));
app.use('/api/atendimentos', require('./routes/atendimentos'));
app.use('/api/financeiro', require('./routes/financeiro'));
app.use('/api/estoque', require('./routes/estoque'));
app.use('/api/relatorios', require('./routes/relatorios'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/usuarios', require('./routes/usuarios'));

app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'A solicitação é muito grande.' });
  console.error('Erro na API:', err.code || err.name, err.message);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

if (require.main === module) {
  const PORTA = Number(process.env.PORT || 3000);
  const server = app.listen(PORTA, () => console.log('SGCP rodando em http://localhost:' + PORTA));

  function encerrar(signal) {
    console.log('Encerrando SGCP (' + signal + ').');
    server.close(() => {
      db.end().finally(() => process.exit(0));
    });
  }
  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));
}

module.exports = app;
