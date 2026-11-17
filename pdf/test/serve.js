// Static server for the browser tests: serves the repo root like CF Pages
// would (JS MIME for .js, nosniff), so module/worker loading is exercised.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.json': 'application/json', '.png': 'image/png' };
function serve(overrides = {}) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    let f = overrides[p] || path.join(ROOT, p);
    if (!overrides[p] && (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory())) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}
module.exports = { serve, ROOT };
