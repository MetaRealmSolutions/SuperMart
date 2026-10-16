import path from 'node:path';
import { createApp } from './app';
import { createServer } from './http';

const port = Number(process.env.PORT ?? 4000);
// Loopback by default. Binding to the LAN (HOST=0.0.0.0) is an explicit decision — see docs/ARCHITECTURE.md.
const host = process.env.HOST ?? '127.0.0.1';
const dbFile = process.env.SUPERMART_DB ?? path.join(process.cwd(), 'data', 'supermart.db');
const edition = (process.env.SUPERMART_EDITION as 'basic' | 'inventory' | 'full' | undefined) ?? 'full';

const app = createApp({ file: dbFile, seedIfEmpty: true, edition });
const staticDir = process.env.SUPERMART_STATIC ?? path.join(process.cwd(), 'dist');
const server = createServer(app, { staticDir });
server.listen(port, host, () => {
  console.log(`SuperMart server listening on http://${host}:${port}  (db: ${dbFile})`);
});

const shutdown = () => {
  server.close();
  app.db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
