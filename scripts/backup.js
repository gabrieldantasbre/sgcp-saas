require('dotenv').config({ quiet: true });
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const pasta = path.join(__dirname, '..', 'backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const destino = path.join(pasta, 'sgcp-' + timestamp + '.dump');
const parcial = destino + '.partial';
function localizarPgDump() {
  if (process.env.PG_DUMP_PATH) return process.env.PG_DUMP_PATH;
  if (process.platform === 'win32') {
    const base = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
    if (fs.existsSync(base)) {
      const versions = fs.readdirSync(base).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const version of versions) {
        const executable = path.join(base, version, 'bin', 'pg_dump.exe');
        if (fs.existsSync(executable)) return executable;
      }
    }
  }
  return 'pg_dump';
}
const pgDump = localizarPgDump();

async function main() {
  if (!process.env.DB_PASSWORD) throw new Error('Defina DB_PASSWORD no arquivo .env antes de gerar o backup.');
  fs.mkdirSync(pasta, { recursive: true });
  const args = [
    '--host', process.env.DB_HOST || 'localhost',
    '--port', String(process.env.DB_PORT || 5432),
    '--username', process.env.DB_USER || 'postgres',
    '--no-password', '--format=custom', '--file', parcial,
    process.env.DB_NAME || 'sgcp',
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(pgDump, args, {
      env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error('pg_dump encerrou com cÃ³digo ' + code)));
  });

  if (!fs.existsSync(parcial) || fs.statSync(parcial).size === 0) throw new Error('pg_dump nÃ£o gerou um arquivo de backup vÃ¡lido.');
  fs.renameSync(parcial, destino);
  console.log('Backup criado:', destino);
}

main().catch((error) => {
  try { fs.rmSync(parcial, { force: true }); } catch {}
  console.error('Falha no backup:', error.message);
  process.exitCode = 1;
});
