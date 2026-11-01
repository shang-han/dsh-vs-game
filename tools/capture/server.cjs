// 龙娘帧捕获工具：把 assets/dragon 的 Coopanion 骨骼渲染成 PNG 帧，给 canvas 直接用。
// 用法：node tools/capture/server.cjs → 用 Edge headless 打开 http://127.0.0.1:61945/
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'assets');
const OUT = path.join(ASSETS, 'dragon', 'frames');
const PORT = Number(process.env.CAP_PORT || 61945);
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
};

let saved = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/save') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const name = String(url.searchParams.get('name') || 'frame').replace(/[^\w.-]/g, '_');
      const base64 = body.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(base64, 'base64'));
      saved++;
      console.log('saved', name, base64.length);
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    });
    return;
  }
  if (url.pathname === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ saved }));
    return;
  }
  let file = url.pathname === '/' ? path.join(__dirname, 'capture.html') : path.join(ASSETS, url.pathname.replace(/^\/assets\//, ''));
  if (!file.startsWith(ASSETS) && url.pathname !== '/') {
    res.writeHead(403).end('no');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
});
server.listen(PORT, '127.0.0.1', () => console.log('capture server on', PORT, '->', OUT));
