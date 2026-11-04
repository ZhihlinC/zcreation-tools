// Headless save → reopen round trip (SPEC §10) + a few UI checks.
// 2026-11-05 fixes: copy of audits/2026-11-05-coverage-spec/roundtrip.js with
// the minimum changes needed for the new UI (diff listed in README.md):
//   - "+ Add Speaker" / "+ Add Phantom" now open forms → submit them
//     (speaker: pre-filled defaults; phantom: type 0 / 0 / 250, the position
//     the old button used to insert);
//   - Chromium launched with a UTF-8 locale (Unicode download names);
//   - §2 probe string follows the new English wording ("It is not an
//     acoustic simulation");
//   - extra lines: free-camera equality, disabled-speaker label after reopen.
// Usage: P5_LOCAL=/path/to/p5.min.js node roundtrip.js
//   P5_LOCAL: a local copy of p5@1.11.0/lib/p5.min.js (e.g. from `npm pack p5@1.11.0`).
//   The CDN request in coverage/index.html is routed to that file so the test
//   runs without network access to cdn.jsdelivr.net.
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '../..');
const P5 = process.env.P5_LOCAL;
if (!P5 || !fs.existsSync(P5)) { console.error('set P5_LOCAL to a local p5.min.js (1.11.0)'); process.exit(2); }
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-rt-'));

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, acceptDownloads: true, deviceScaleFactor: 1 });
  await ctx.route('https://cdn.jsdelivr.net/npm/p5@1.11.0/lib/p5.min.js', r => r.fulfill({ path: P5, contentType: 'text/javascript' }));
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.__errors.push('console.error: ' + m.text()); });
  page.on('dialog', d => { page.__lastDialog = d.message(); d.accept(); });
  return page;
}
const ready = page => page.waitForFunction(() => typeof cam !== 'undefined' && cam && typeof frameCount !== 'undefined' && frameCount > 3);

// Everything that should survive a round trip, read from the page.
const snapshot = page => page.evaluate(() => {
  const s = JSON.parse(JSON.stringify(STATE));
  return {
    state: s,
    ui: {
      title: document.title,
      layoutNameInput: document.getElementById('layout-name').value,
      unitActive: [...document.querySelectorAll('#meta-panel button[data-unit].active')].map(b => b.dataset.unit),
      viewActive: [...document.querySelectorAll('#view-controls button.active')].map(b => b.dataset.view),
      layerChecks: Object.fromEntries([...document.querySelectorAll('#layers-panel input[data-layer]')].map(i => [i.dataset.layer, i.checked])),
      audienceInputs: [...document.querySelectorAll('input[data-audience]')].map(i => i.value),
      speakerRows: [...document.querySelectorAll('.speaker-item')].map(li => ({
        name: li.querySelector('header input[type=text]').value,
        enabled: li.querySelector('header input[type=checkbox]').checked,
        fields: [...li.querySelectorAll('input[data-field]')].map(i => i.value),
        derived: li.querySelector('.speaker-derived').textContent })),
      phantomRows: [...document.querySelectorAll('.phantom-item')].map(li => ({
        name: li.querySelector('header input[type=text]').value,
        fields: [...li.querySelectorAll('input[data-field]')].map(i => i.value) })),
      healthHidden: document.getElementById('health-panel').hidden,
      healthLines: [...document.querySelectorAll('#health-panel-status p')].map(p => p.textContent),
      triStatus: document.getElementById('triangulation-status').textContent,
      camEye: [cam.eyeX, cam.eyeY, cam.eyeZ].map(v => Math.round(v)),
      disclaimerCollapsed: document.getElementById('disclaimer').classList.contains('collapsed'),
      saveHtmlHidden: document.getElementById('save-html-btn').hidden,
      openHtmlHidden: document.getElementById('open-html-btn').hidden,
      camFull: [cam.eyeX, cam.eyeY, cam.eyeZ, cam.centerX, cam.centerY, cam.centerZ, cam.upX, cam.upY, cam.upZ].map(v => Math.round(v * 1000) / 1000),
      disabledLabels: STATE.speakers.filter(s => !s.enabled).map(s => s.name + ':' + getComputedStyle(document.getElementById('speaker-label-' + s.id)).visibility),
    },
  };
});

function diff(a, b, p = '') {
  const out = [];
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return [`${p}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
  if (a && typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...diff(a[k], b[k], p + '.' + k));
  } else if (a !== b) out.push(`${p}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  return out;
}

async function setNumber(locator, v) { await locator.fill(String(v)); }

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  const log = (...a) => console.log(...a);

  // ---------- 1. Build a non-default layout through the real UI ----------
  const page = await newPage(browser);
  await page.goto(base + '/coverage/');
  await ready(page);
  log('boot errors:', page.__errors.length ? page.__errors : 'none');

  await page.fill('#layout-name', 'RT 工作坊 Test');
  // audience
  await setNumber(page.locator('input[data-audience="length"]'), 900);
  await setNumber(page.locator('input[data-audience="width"]'), 700);
  await setNumber(page.locator('input[data-audience="listeningHeight"]'), 110);
  // add 3 speakers and edit the 4th..6th rows
  for (let i = 0; i < 3; i++) { await page.click('#add-speaker-btn'); await page.click('#add-speaker-form [data-action="add"]'); }
  const rows = page.locator('.speaker-item');
  const edits = [
    { x: -400, y: -300, z: 300, yaw: 45, pitch: -15, angleH: 100, angleV: 40, name: 'Ls' },
    { x: 400, y: -300, z: 300, yaw: -45, pitch: -15, angleH: 100, angleV: 40, name: 'Rs' },
    { x: 0, y: 0, z: 650, yaw: 0, pitch: -90, angleH: 120, angleV: 30, name: 'Top' },
  ];
  for (let k = 0; k < edits.length; k++) {
    const row = rows.nth(3 + k);
    await row.locator('.expand-btn').click();
    for (const f of ['x', 'y', 'z', 'yaw', 'pitch', 'angleH', 'angleV']) await setNumber(row.locator(`input[data-field="${f}"]`), edits[k][f]);
    await row.locator('header input[type=text]').fill(edits[k].name);
  }
  // disable C
  await rows.nth(2).locator('header input[type=checkbox]').uncheck();
  // phantoms
  for (let i = 0; i < 2; i++) {
    await page.click('#add-phantom-btn');
    await page.fill('#add-phantom-form input[name="x"]', '0');
    await page.fill('#add-phantom-form input[name="y"]', '0');
    await page.fill('#add-phantom-form input[name="z"]', '250');
    await page.click('#add-phantom-form [data-action="add"]');
  }
  const prow = page.locator('.phantom-item').nth(1);
  await prow.locator('.expand-btn').click();
  await setNumber(prow.locator('input[data-field="z"]'), -200);
  await prow.locator('header input[type=text]').fill('Nadir');
  // layers + view + unit
  await page.check('input[data-layer="coords"]');
  await page.check('input[data-layer="triangulation"]');
  await page.uncheck('input[data-layer="cones"]');
  await page.uncheck('input[data-layer="health-panel"]');
  await page.check('input[data-layer="health-panel"]');
  await page.uncheck('input[data-layer="axes"]');
  await page.click('#view-controls button[data-view="side"]');
  await page.click('#meta-panel button[data-unit="m"]');
  // orbit the camera a little (mouse drag on canvas) to see whether the free camera is kept
  // headless software GL runs at ~4 fps, so every drag step waits for a frame
  const eyeBeforeOrbit = await page.evaluate(() => [cam.eyeX, cam.eyeY, cam.eyeZ].map(Math.round));
  await page.mouse.move(700, 600); await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(700 + i * 25, 600 + i * 5); await page.waitForTimeout(350); }
  await page.mouse.up(); await page.waitForTimeout(500);
  log('orbit drag moved camera eye:', eyeBeforeOrbit, '->', await page.evaluate(() => [cam.eyeX, cam.eyeY, cam.eyeZ].map(Math.round)));
  const before = await snapshot(page);
  await page.screenshot({ path: path.join(OUT, 'before.png') });

  // ---------- 2. Save HTML ----------
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save-html-btn')]);
  const savedPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(savedPath);
  const savedHtml = fs.readFileSync(savedPath, 'utf8');
  log('\nsaved file:', dl.suggestedFilename(), (savedHtml.length / 1024).toFixed(0) + ' KB');
  log('  starts with metadata comment:', /^<!doctype html>\n<!--\n  Generated by Sound Coverage Sketch/.test(savedHtml));
  log('  <title>:', /<title>(.*?)<\/title>/.exec(savedHtml)[1]);
  log('  p5 still from CDN:', savedHtml.includes('https://cdn.jsdelivr.net/npm/p5@1.11.0/lib/p5.min.js'));
  log('  inline css / js / state present:', ['coverage-style-inline', 'coverage-script-inline', 'id="coverage-state"'].map(k => savedHtml.includes(k)));
  log('  state script precedes inline js:', savedHtml.indexOf('id="coverage-state"') < savedHtml.indexOf('id="coverage-script-inline"'));
  log('  §2 disclaimer zh+en present in saved file:', savedHtml.includes('不預測 SPL') && savedHtml.includes('It is not an acoustic simulation'));
  log('  #canvas-host emptied in saved file:', /<main id="canvas-host"[^>]*><\/main>/.test(savedHtml));

  // ---------- 3. Re-open the saved file directly (file://) ----------
  const p2 = await newPage(browser);
  await p2.goto('file://' + savedPath);
  await ready(p2);
  await p2.waitForTimeout(300);
  const after = await snapshot(p2);
  await p2.screenshot({ path: path.join(OUT, 'after-file.png') });
  log('\n[file:// reopen] errors:', p2.__errors.length ? p2.__errors : 'none');
  const ignore = ['.state.metadata']; // createdAt etc. are regenerated
  const d1 = diff(before.state, after.state, '.state').filter(x => !ignore.some(i => x.startsWith(i)));
  log('  STATE diff (excluding metadata):', d1.length ? d1 : 'identical');
  log('  layoutName:', JSON.stringify(before.state.metadata.layoutName), '->', JSON.stringify(after.state.metadata.layoutName));
  const uiKeys = ['layoutNameInput', 'unitActive', 'viewActive', 'layerChecks', 'audienceInputs', 'speakerRows', 'phantomRows', 'healthHidden', 'healthLines', 'triStatus'];
  const d2 = uiKeys.flatMap(k => diff(before.ui[k], after.ui[k], '.ui.' + k));
  log('  UI diff:', d2.length ? d2 : 'identical');
  log('  camera eye before save (after orbit):', before.ui.camEye, ' after reopen:', after.ui.camEye, '(cameraPreset =', after.state.view.cameraPreset + ')');
  log('  free camera (eye+centre+up) identical after file:// reopen:', JSON.stringify(before.ui.camFull) === JSON.stringify(after.ui.camFull));
  log('  disabled speaker labels before save / after reopen:', JSON.stringify(before.ui.disabledLabels), '/', JSON.stringify(after.ui.disabledLabels));
  log('  snapshot hides Save HTML / Open HTML:', after.ui.saveHtmlHidden, '/', after.ui.openHtmlHidden);

  await p2.context().close();
  // ---------- 4. Re-open through the live tool's Open HTML ----------
  const p3 = await newPage(browser);
  await p3.goto(base + '/coverage/');
  await ready(p3);
  await p3.setInputFiles('#open-html-input', savedPath);
  await p3.waitForFunction(n => STATE.speakers.length === n && TRIANGULATION.result && !TRIANGULATION.dirty, before.state.speakers.length);
  await p3.waitForTimeout(1500);
  const after3 = await snapshot(p3);
  const d3 = diff(before.state, after3.state, '.state').filter(x => !ignore.some(i => x.startsWith(i)));
  log('\n[live Open HTML] errors:', p3.__errors.length ? p3.__errors : 'none');
  log('  STATE diff (excluding metadata):', d3.length ? d3 : 'identical');
  const d4 = uiKeys.filter(k => k !== 'title').flatMap(k => diff(before.ui[k], after3.ui[k], '.ui.' + k));
  log('  UI diff:', d4.length ? d4 : 'identical');
  log('  document.title after Open HTML:', JSON.stringify(after3.ui.title));
  log('  free camera (eye+centre+up) identical after live Open HTML:', JSON.stringify(before.ui.camFull) === JSON.stringify(after3.ui.camFull));
  log('  disabled speaker labels after live Open HTML:', JSON.stringify(after3.ui.disabledLabels));

  // 4b. second-generation save from the live tool after re-open → same state again
  const [dl2] = await Promise.all([p3.waitForEvent('download'), p3.click('#save-html-btn')]);
  const saved2 = path.join(OUT, 'gen2-' + dl2.suggestedFilename()); await dl2.saveAs(saved2);
  const st = h => JSON.parse(/<script id="coverage-state" type="application\/json">([\s\S]*?)<\/script>/.exec(h)[1].replace(/\\u003c/g, '<'));
  const g1 = st(savedHtml), g2 = st(fs.readFileSync(saved2, 'utf8'));
  delete g1.metadata.createdAt; delete g2.metadata.createdAt;
  log('  gen-1 vs gen-2 embedded state:', diff(g1, g2).length ? diff(g1, g2) : 'identical');

  await p3.context().close(); await page.context().close();
  // ---------- 5. Failure paths: STATE must be untouched ----------
  const p4 = await newPage(browser);
  await p4.goto(base + '/coverage/');
  await ready(p4);
  const s0 = await p4.evaluate(() => JSON.stringify(STATE));
  const bad1 = path.join(OUT, 'not-a-sketch.html'); fs.writeFileSync(bad1, '<html><body>hello</body></html>');
  const bad2 = path.join(OUT, 'schema2.html'); fs.writeFileSync(bad2, savedHtml.replace('"schemaVersion": 1', '"schemaVersion": 2'));
  const bad3 = path.join(OUT, 'brokenjson.html'); fs.writeFileSync(bad3, savedHtml.replace('"schemaVersion": 1', '"schemaVersion": 1,,'));
  for (const f of [bad1, bad2, bad3]) {
    const dlg = p4.waitForEvent('dialog');
    await p4.setInputFiles('#open-html-input', f);
    await dlg; await p4.waitForTimeout(300);
    const s1 = await p4.evaluate(() => JSON.stringify(STATE));
    log(`\n[bad file ${path.basename(f)}] alert: ${JSON.stringify((p4.__lastDialog || '').replace(/\s+/g, ' ').slice(0, 110))}  STATE unchanged: ${s0 === s1}`);
  }

  await p4.context().close();
  // ---------- 6. Misc UI probes ----------
  const p5 = await newPage(browser);
  await p5.goto(base + '/coverage/');
  await ready(p5);
  // 6a. disabled speaker's name label
  await p5.locator('.speaker-item').nth(0).locator('header input[type=checkbox]').uncheck();
  await p5.click('#view-controls button[data-view="top"]');
  await p5.waitForTimeout(200);
  const lab = await p5.evaluate(() => { const e = document.getElementById('speaker-label-s1'); return { visibility: getComputedStyle(e).visibility, display: getComputedStyle(e).display, text: e.textContent, left: e.style.left }; });
  log('\n[disabled speaker "L"] name label after disable + view change:', JSON.stringify(lab));
  // 6b. speakers layer off → speaker name labels?
  await p5.uncheck('input[data-layer="speakers"]');
  await p5.waitForTimeout(200);
  const lab2 = await p5.evaluate(() => { const e = document.getElementById('speaker-label-s2'); return getComputedStyle(e).visibility + '/' + getComputedStyle(document.getElementById('speaker-labels')).display; });
  log('[speakers layer OFF] label "R" visibility/display:', lab2);
  // 6c. wheel zoom limits
  await p5.check('input[data-layer="speakers"]');
  const dist = () => p5.evaluate(() => Math.hypot(cam.eyeX - cam.centerX, cam.eyeY - cam.centerY, cam.eyeZ - cam.centerZ));
  const d0 = await dist();
  await p5.mouse.move(700, 600);
  for (let i = 0; i < 25; i++) { await p5.mouse.wheel(0, -3000); await p5.waitForTimeout(250); }
  await p5.waitForTimeout(1500);
  const dMin = await dist();
  for (let i = 0; i < 25; i++) { await p5.mouse.wheel(0, 20000); await p5.waitForTimeout(250); }
  await p5.waitForTimeout(1500);
  const dMax = await dist();
  log(`[wheel zoom] camera distance start=${d0.toFixed(0)}  after zoom-in spam=${dMin.toFixed(1)}  after zoom-out spam=${dMax.toFixed(0)}`);
  // 6d. built-in dev tests inside the browser
  const dev = await p5.evaluate(() => { const o = console.log, e = console.error; console.log = () => {}; console.error = () => {}; const r = __triangulationDevTests(); console.log = o; console.error = e; return r.passed + '/' + r.total; });
  log('[in-browser __triangulationDevTests]', dev);
  // 6e. draw() cost with a 32-speaker layout, coords + triangulation on (software GL in headless; relative only)
  const perf = await p5.evaluate(async () => {
    STATE.speakers = [];
    for (let i = 0; i < 32; i++) {
      const az = (i % 16) / 16 * 2 * Math.PI, z = i < 16 ? 120 : 400, r = i < 16 ? 500 : 300;
      const s = { id: 's' + (100 + i), name: 'S' + i, enabled: true, x: r * Math.sin(az), y: r * Math.cos(az), z, yaw: 0, pitch: 0, angleH: 90, angleV: 60 };
      Object.assign(s, aimAtCentre(s.x, s.y, s.z)); STATE.speakers.push(s);
    }
    STATE.view.layers.coords = true; STATE.view.layers.triangulation = true;
    syncUiFromState();
    await new Promise(r => setTimeout(r, 300));
    const t = []; const orig = window.draw;
    noLoop();
    for (let i = 0; i < 10; i++) { const a = performance.now(); redraw(); t.push(performance.now() - a); }
    loop();
    t.sort((a, b) => a - b);
    const c0 = performance.now(); for (let i = 0; i < 20; i++) computeCoverage(); const cov = (performance.now() - c0) / 20;
    const a0 = performance.now(); for (let i = 0; i < 20; i++) analyseTriangulation(); const tri = (performance.now() - a0) / 20;
    return { redrawMedianMs: t[5].toFixed(1), computeCoverageMs: cov.toFixed(2), analyseTriangulationMs: tri.toFixed(2) };
  });
  log('[perf, headless SwiftShader] redraw() ms with 32 speakers:', JSON.stringify(perf));

  await p5.context().close();
  // 6f. mobile banner at 800px
  const p6 = await newPage(browser, { viewport: { width: 800, height: 900 } });
  await p6.goto(base + '/coverage/');
  await ready(p6);
  log('[viewport 800px] mobile banner visible:', await p6.evaluate(() => !document.getElementById('mobile-banner').hidden),
      ' text:', JSON.stringify(await p6.evaluate(() => document.querySelector('#mobile-banner .banner-text').innerText.replace(/\n/g, ' / '))));


  log('\nartifacts in', OUT);
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
