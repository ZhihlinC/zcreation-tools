// Static server for the browser tests: serves site/ like CF Pages
// would — JS MIME for .js, and the headers from site/_headers
// (nosniff, the /pdf/* CSP) — so module/worker loading runs under the same
// rules as production.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../site');
// _headers: "/path/*" lines followed by indented "Name: value" lines.
function readHeaders() {
  const rules = [];
  let cur = null;
  for (const line of fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n')) {
    if (/^\S/.test(line) && !line.startsWith('#')) { cur = { prefix: line.trim().replace(/\*$/, ''), h: {} }; rules.push(cur); }
    else if (cur && /^\s+\S+:/.test(line)) { const i = line.indexOf(':'); cur.h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  }
  return p => Object.assign({}, ...rules.filter(r => p.startsWith(r.prefix)).map(r => r.h));
}
const headersFor = readHeaders();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.json': 'application/json', '.png': 'image/png' };
function serve(overrides = {}) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    let f = overrides[p] || path.join(ROOT, p);
    if (!overrides[p] && (!(f === ROOT || f.startsWith(ROOT + path.sep)) || !fs.existsSync(f) || fs.statSync(f).isDirectory())) { res.writeHead(404); return res.end(); }
    res.writeHead(200, Object.assign(headersFor(p), { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }));
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(Number(process.env.PORT) || 0, process.env.HOST || '127.0.0.1', () => r(srv)));
}
module.exports = { serve, ROOT, headersFor };
