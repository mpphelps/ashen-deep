// Build the browser version, and optionally serve it.
//   node tools/web.ts          build to web/
//   node tools/web.ts --serve  build, serve on localhost, open a browser
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';

const root = path.resolve('web');
const common = { bundle: true, format: 'iife' as const, target: 'es2022', minify: true, sourcemap: false, logLevel: 'warning' as const };
await build({ ...common, entryPoints: ['src/web/main.ts'], outfile: path.join(root, 'game.js') });
await build({ ...common, entryPoints: ['src/web/music-worker.ts'], outfile: path.join(root, 'music-worker.js') });
const kb = (f: string) => (fs.statSync(path.join(root, f)).size / 1024).toFixed(0);
console.log(`built web/game.js (${kb('game.js')} KB) and web/music-worker.js (${kb('music-worker.js')} KB)`);

if (process.argv.includes('--serve')) {
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = path.join(root, url === '/' ? 'index.html' : url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  const port = Number(process.env.PORT ?? 8187);
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`The Ashen Deep is running at ${url}  (Ctrl+C to stop)`);
    if (!process.argv.includes('--no-open')) {
      const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      spawn(cmd[0] as string, cmd[1] as string[], { stdio: 'ignore', detached: true }).unref();
    }
  });
}
