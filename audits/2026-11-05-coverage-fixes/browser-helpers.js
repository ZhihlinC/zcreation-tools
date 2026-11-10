// Shared Playwright helpers for the 2026-11-05 coverage fix tests.
// Serves the repo root over http, routes the p5 CDN URL to a local copy
// (P5_LOCAL), and can substitute coverage.js with another file
// (COVERAGE_JS_OVERRIDE) and coverage/index.html (INDEX_HTML_OVERRIDE) — used by mutation-check.js to prove the browser
// tests fail on a broken implementation.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const P5_URL = 'https://cdn.jsdelivr.net/npm/p5@1.11.0/lib/p5.min.js';

function p5Path() {
  const p = process.env.P5_LOCAL;
  if (!p || !fs.existsSync(p)) {
    console.error('set P5_LOCAL to a local p5@1.11.0/lib/p5.min.js (see README.md)');
    process.exit(2);
  }
  return p;
}

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  const override = process.env.COVERAGE_JS_OVERRIDE;
  const indexOverride = process.env.INDEX_HTML_OVERRIDE;
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    let f = path.join(ROOT, p);
    if (override && p === '/coverage/coverage.js') f = override;
    else if (indexOverride && p === '/coverage/index.html') f = indexOverride;
    else if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    acceptDownloads: true,
    deviceScaleFactor: opts.deviceScaleFactor || 1,
  });
  if (opts.offline) {
    await ctx.route('https://cdn.jsdelivr.net/**', r => r.abort('internetdisconnected'));
  } else {
    await ctx.route(P5_URL, r => r.fulfill({ path: p5Path(), contentType: 'text/javascript' }));
  }
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.__errors.push('console.error: ' + m.text()); });
  page.on('dialog', d => { page.__lastDialog = d.message(); d.accept(); });
  return page;
}

// Chromium on Linux converts download filenames through the process locale;
// under the container's default C locale every non-ASCII name becomes
// "download". Real desktop browsers run with a UTF-8 locale, so the tests do
// too (otherwise the F-06 Unicode-filename check can't be observed).
function launch(chromium, opts = {}) {
  return chromium.launch({ ...opts, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
}

const ready = page => page.waitForFunction(() =>
  typeof cam !== 'undefined' && cam && typeof frameCount !== 'undefined' && frameCount > 3);

const { makeChecker } = require('./checker');

module.exports = { ROOT, serve, newPage, ready, makeChecker, p5Path, launch };
