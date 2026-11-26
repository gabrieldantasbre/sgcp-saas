require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const db = require('../db');

async function main() {
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (' +
    'version VARCHAR(120) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  );

  const directory = path.join(__dirname, '..', 'sql', 'migrations');
  const files = fs.readdirSync(directory).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
  for (const file of files) {
    const { rows } = await db.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
    if (rows.length) {
      console.log('JÃ¡ aplicada:', file);
      continue;
    }

    console.log('Aplicando:', file);
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    await db.query(sql);
    await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    console.log('ConcluÃ­da:', file);
  }
}

main()
  .catch((error) => {
    console.error('Falha na migraÃ§Ã£o:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
