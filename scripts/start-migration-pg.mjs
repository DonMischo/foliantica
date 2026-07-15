/**
 * Start a PERSISTENT embedded PostgreSQL cluster for the one-time migration.
 * Unlike start-test-pg.mjs (persistent: false, temp dir), this keeps the
 * cluster so Electron can reuse it on next launch.
 *
 * Usage:
 *   node scripts/start-migration-pg.mjs <pgdata-dir> [port]
 *
 * Writes "READY" to stdout when PG accepts connections.
 * Send SIGINT or SIGTERM to shut down cleanly.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { mkdirSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';

const DATA_DIR = process.argv[2]
  || path.join(os.homedir(), 'AppData', 'Roaming', 'Foliantica', 'pgdata');
const PORT = process.argv[3] ? Number(process.argv[3]) : 15433;

mkdirSync(DATA_DIR, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'foliantica',
  password: 'foliantica',
  port: PORT,
  persistent: true,   // cluster survives process exit — Electron reuses it
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog:   (msg) => process.stderr.write('[pg] '     + msg + '\n'),
  onError: (msg) => process.stderr.write('[pg-err] ' + msg + '\n'),
});

process.on('SIGINT',  () => pg.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => pg.stop().then(() => process.exit(0)));

// initialise() always runs initdb — skip it when the cluster already exists.
const alreadyInitialised = existsSync(path.join(DATA_DIR, 'PG_VERSION'));
if (!alreadyInitialised) {
  await pg.initialise();
}
await pg.start();
await pg.createDatabase('foliantica').catch(() => {});
process.stdout.write('READY\n');
// Block — caller sends SIGTERM when done
