import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { App } from './ctx';
import { handleRequest } from './app';
import { AppError } from './errors';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const MAX_BODY = 5 * 1024 * 1024;

function isLocalOrigin(origin: string | undefined): boolean {
  return !!origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function createServer(app: App, opts: { staticDir?: string } = {}): http.Server {
  const staticDir = opts.staticDir;
  return http.createServer((req, res) => {
    const origin = req.headers.origin as string | undefined;
    // CORS is only granted to localhost origins (Expo dev server). Same-origin production needs none.
    if (isLocalOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin!);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/rpc' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        const send = (status: number, body: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(JSON.stringify(body));
        };
        try {
          const { method, input } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (typeof method !== 'string') throw new AppError('VALIDATION', 'method is required');
          const auth = req.headers.authorization;
          const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
          send(200, { ok: true, result: handleRequest(app, token, method, input) });
        } catch (e) {
          if (e instanceof AppError) send(e.httpStatus, { ok: false, error: { code: e.code, message: e.message, details: e.details } });
          else {
            console.error(e);
            send(500, { ok: false, error: { code: 'INTERNAL', message: 'Unexpected server error. See server log.' } });
          }
        }
      });
      return;
    }
    if (staticDir && (req.method === 'GET' || req.method === 'HEAD')) {
      let file = path.join(staticDir, decodeURIComponent(url.pathname));
      if (!file.startsWith(path.resolve(staticDir))) {
        res.writeHead(403).end();
        return;
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(staticDir, 'index.html');
      if (!fs.existsSync(file)) {
        res.writeHead(404).end('Web build not found. Run `npm run build:web` first.');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404).end();
  });
}
