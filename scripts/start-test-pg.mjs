/**
 * Start an embedded PostgreSQL instance for testing.
 * Writes "READY" to stdout when PG is accepting connections.
 * Keep this process alive while running tests; Ctrl-C to stop.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const DATA_DIR = path.join(tmpdir(), 'foliantica-pg-test');
mkdirSync(DATA_DIR, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'foliantica',
  password: 'foliantica',
  port: 5433,
  persistent: false,   // wipe cluster on stop so tests are repeatable
  // Force UTF-8 cluster so Unicode characters in seed data don't fail
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: (msg) => process.stderr.write('[pg] ' + msg + '\n'),
  onError: (msg) => process.stderr.write('[pg-err] ' + msg + '\n'),
});

process.on('SIGINT',  () => pg.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => pg.stop().then(() => process.exit(0)));

await pg.initialise();
await pg.start();
await pg.createDatabase('foliantica').catch(() => {});
process.stdout.write('READY\n');
// Block forever — caller kills us when done
