// Mutation check: for every fix, revert / break the implementation in a temp
// copy of coverage.js (or index.html) and confirm the test suite FAILS on it.
// A mutation that the tests don't catch is reported as SURVIVED.
//
// Usage:
//   node mutation-check.js                 # Node-suite mutations only (fast)
//   P5_LOCAL=... node mutation-check.js --browser   # also browser-suite ones (~2–3 min each, 3 in parallel)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../../site');
const JS = fs.readFileSync(path.join(ROOT, 'coverage/coverage.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'coverage/index.html'), 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-mut-'));

// Each mutation: id (finding), what it does, file, find → replace (find must
// occur exactly once), suite, and a regex one of the FAIL lines must match.
const M = [
  // ---- Node suite
  { id: 'F-01', what: 'drop the enclosure check', suite: 'node', expect: /F-01|D1|D5|atmos/i,
    find: 'if (!(minPlaneOffset > ENCLOSE_EPS)) {', replace: 'if (false) {' },
  { id: 'F-01', what: 'enclosure ε = 0 instead of sin 1°', suite: 'node', expect: /F-01|D5|F2|atmos/i,
    find: 'const ENCLOSE_EPS = Math.sin(ENCLOSE_DEG * Math.PI / 180);', replace: 'const ENCLOSE_EPS = 0;' },
  { id: 'B1', what: 'planar test back to "every point within ±1° of ear level"', suite: 'node', expect: /B1|P-03|planar|small-circle/,
    find: 'if (Math.max(...elev) - Math.min(...elev) <= PLANAR_ELEVATION_DEG * Math.PI / 180) {', replace: 'if (merged.every(p => Math.abs(p.dir.z) <= Math.sin(Math.PI / 180))) {' },
  { id: 'T1', what: 'planar tolerance back to 1°', suite: 'node', expect: /T1|P-03|B1|planar/,
    find: 'const PLANAR_ELEVATION_DEG = 2;', replace: 'const PLANAR_ELEVATION_DEG = 1;' },
  { id: 'T4', what: 'blank names no longer shown as (unnamed)', suite: 'node', expect: /T4/,
    find: "bad.map(n => n.trim() ? n : '(unnamed)')", replace: 'bad' },
  { id: 'B7', what: 'loader stops recording replaced values (no warning)', suite: 'node', expect: /B7/,
    find: 'if (v !== undefined && bad) bad.push(owner);', replace: '' },
  { id: 'B7', what: 'open dialog no longer shows the warning', suite: 'browser', expect: /B7/,
    find: 'if (warning) alert(warning);', replace: '' },
  { id: 'F-03', what: 'region from vertex centroid instead of face normal', suite: 'node', expect: /F-03|D7|region/,
    find: '    regions[i] = faceRegion(f);', replace: '    regions[i] = regionForDirection({ x: A.x + B.x + C.x, y: A.y + B.y + C.y, z: A.z + B.z + C.z });' },
  { id: 'F-03', what: 'tie → first label only', suite: 'node', expect: /tie/,
    find: "return top.length >= 2 ? `${top[0]} and ${top[1]}` : top[0];", replace: 'return top[0];' },
  { id: 'F-03', what: 're-add the centerline rule', suite: 'node', expect: /centerline|region-max|F-03|labels-only/,
    find: "  if (d.y < -0.7) return 'rear';\n  const ax", replace: "  if (d.y < -0.7) return 'rear';\n  if (Math.abs(d.x) < 0.3) return 'centerline';\n  const ax" },
  { id: 'F-02', what: 'per-face visibility (no connected flood fill)', suite: 'node', expect: /J-rounding|D3|J2/,
    find: '  const visible = new Uint8Array(n);\n  visible[seedFace] = 1;', replace: '  const visible = new Uint8Array(n);\n  for (let i = 0; i < n; i++) if (dist[i] > HULL_VISIBILITY_EPS) visible[i] = 1;' },
  { id: 'F-02', what: 'drop the manifold guard', suite: 'node', expect: /F-02 guard/,
    find: '    try { assertManifoldOrThrow(hull.faces); } catch (e) { manifoldError = e.message; }', replace: '' },
  { id: 'F-05', what: 'old basis (forward × world-up, +Y fallback)', suite: 'node', expect: /F-05/,
    find: '  const r = { x: Math.cos(yr), y: -Math.sin(yr), z: 0 };',
    replace: '  const wu = (Math.abs(f.z) > 0.999) ? [0, 1, 0] : [0, 0, 1];\n  let r = { x: f.y * wu[2] - f.z * wu[1], y: f.z * wu[0] - f.x * wu[2], z: f.x * wu[1] - f.y * wu[0] };\n  const rm = Math.hypot(r.x, r.y, r.z); r = { x: r.x / rm, y: r.y / rm, z: r.z / rm };' },
  { id: 'F-06', what: 'ASCII-only filename filter', suite: 'node', expect: /F-06/,
    find: "    .replace(/[\\\\/:*?\"<>|\\u0000-\\u001f\\u007f]+/g, '-')", replace: "    .replace(/[^\\w\\-]+/g, '-')" },
  { id: 'F-16', what: 'merge into current STATE instead of reset', suite: 'node', expect: /F-16/,
    find: '  const next = makeDefaultState();\n  const bad', replace: '  const next = JSON.parse(JSON.stringify(STATE));\n  const bad' },
  { id: 'F-16', what: 'audience accepts ≤ 0', suite: 'node', expect: /F-16/,
    find: 'function isValidAudienceValue(v) { return isValidFinite(v) && v > 0; }', replace: 'function isValidAudienceValue(v) { return isValidFinite(v); }' },
  { id: 'F-19', what: 'spread allows ≥ 180°', suite: 'node', expect: /F-19|spread/,
    find: 'function isValidSpread(v) { return isValidFinite(v) && v > 0 && v < 180; }', replace: 'function isValidSpread(v) { return isValidFinite(v) && v > 0; }' },
  { id: 'F-17', what: 'no 0.01 cm rounding', suite: 'node', expect: /F-17/,
    find: "return STATE.view.unit === 'm' ? Math.round(displayed * 100 * 100) / 100 : displayed;", replace: "return STATE.view.unit === 'm' ? displayed * 100 : displayed;" },
  { id: 'F-15', what: 'clamp does nothing', suite: 'node', expect: /F-15/,
    find: '  const target = Math.min(CAMERA_DISTANCE_LIMITS.max, Math.max(CAMERA_DISTANCE_LIMITS.min, d));', replace: '  const target = d;' },
  { id: 'Q-01', what: 'camera not serialised', suite: 'node', expect: /Q-01/,
    find: '      camera: STATE.view.camera\n        ?', replace: '      camera: false\n        ?' },
  { id: 'Q-01', what: 'boot loader moved back to the top (TDZ)', suite: 'node', expect: /boot loader|Q-01/,
    custom: (src) => {
      const start = src.indexOf('// Boot-time embedded-state loader.');
      const block = src.slice(start);
      const anchor = '// (The boot-time embedded-state loader lives at the END of this file';
      return src.slice(0, start).replace(anchor, block + '\n' + anchor);
    } },
  { id: 'P-04', what: 'no inline-script escaping', suite: 'node', expect: /P-04/,
    find: "  return String(text)\n    .replace(/<\\/(script)/gi, '<\\\\/$1')\n    .replace(/<!--/g, '<\\\\!--');", replace: '  return String(text);' },
  { id: 'F-10', what: 'math depends on p5 radians() again', suite: 'node', expect: /F-10|F-05|crash/,
    find: 'function degToRad(d) { return d * DEG2RAD; }', replace: 'function degToRad(d) { return radians(d); }' },
  { id: 'F-19', what: 'title helper ignores the layout name', suite: 'node', expect: /F-19/,
    find: "  return n ? `${n} — Sound Coverage Sketch` : 'Sound Coverage Sketch';", replace: "  return 'Sound Coverage Sketch';" },
  // ---- Browser suite
  { id: 'F-07', what: 'disabled speakers skip label update (old code)', suite: 'browser', expect: /F-07/,
    find: "      if (!s.enabled) { el.style.visibility = 'hidden'; continue; }\n      positionLabel(el, s.x, s.y, s.z + 40);", replace: '      if (!s.enabled) continue;\n      positionLabel(el, s.x, s.y, s.z + 40);' },
  { id: 'F-07', what: 'speaker label host ignores the layer', suite: 'browser', expect: /F-07/,
    find: "  if (speakerHost) speakerHost.style.display = showSpeakers ? '' : 'none';", replace: '' },
  { id: 'F-15', what: 'per-frame clamp not called', suite: 'browser', expect: /F-15/,
    find: '    orbitControl(1.5, 1.5, 0.5);\n    enforceCameraDistance();', replace: '    orbitControl(1.5, 1.5, 0.5);' },
  { id: 'F-18', what: 'PNG upscaled instead of re-rendered', suite: 'browser', expect: /F-18/,
    find: '    if (prevDensity !== scale) {\n      pixelDensity(scale);\n      applyProjection();\n    }\n    redraw();', replace: '    redraw();' },
  { id: 'Q-01', what: 'orbit not tracked', suite: 'browser', expect: /Q-01/,
    find: '  trackFreeCamera();\n  drawScene();', replace: '  drawScene();' },
  { id: 'Q-07a', what: 'phantom form pre-fills the zenith', suite: 'browser', expect: /Q-07a/,
    find: "  for (const k of ['x', 'y', 'z']) form.elements[k].value = '';", replace: "  form.elements.x.value = 0; form.elements.y.value = 0; form.elements.z.value = 250;" },
  { id: 'Q-07a', what: 'speaker form not auto-aimed', suite: 'browser', expect: /Q-07a/,
    find: "  for (const k of ['yaw', 'pitch', 'angleH', 'angleV']) form.elements[k].value = d[k];", replace: "  for (const k of ['yaw', 'pitch', 'angleH', 'angleV']) form.elements[k].value = k.startsWith('angle') ? d[k] : 0;" },
  { id: 'F-10', what: 'offline notice never shown', suite: 'browser', expect: /F-10/,
    find: '    if (notice) notice.hidden = false;', replace: '' },
  { id: 'F-19', what: 'title not updated after Open HTML', suite: 'browser', expect: /F-19/,
    find: '  document.title = layoutTitle(STATE.metadata.layoutName);', replace: '' },
  { id: 'F-08', what: 'phantom note removed from the panel', suite: 'browser', file: 'html', expect: /F-08/,
    custom: (src) => src.replace(/\n\s*<p class="panel-note" id="phantoms-note">[^<]*<\/p>/, '') },
];

function mutate(m) {
  const src = m.file === 'html' ? HTML : JS;
  let out;
  if (m.custom) out = m.custom(src);
  else {
    const n = src.split(m.find).length - 1;
    if (n !== 1) throw new Error(`${m.id} "${m.what}": find string occurs ${n}×`);
    out = src.replace(m.find, () => m.replace);
  }
  if (out === src) throw new Error(`${m.id} "${m.what}": mutation changed nothing`);
  const f = path.join(TMP, `${m.id}-${Math.random().toString(36).slice(2)}.${m.file === 'html' ? 'html' : 'js'}`);
  fs.writeFileSync(f, out);
  return f;
}

function run(m) {
  return new Promise((resolve) => {
    const f = mutate(m);
    const env = { ...process.env };
    if (m.file === 'html') env.INDEX_HTML_OVERRIDE = f; else env.COVERAGE_JS_OVERRIDE = f;
    const script = m.suite === 'node' ? 'test-fixes-node.js' : 'test-fixes-browser.js';
    const child = spawn(process.execPath, [path.join(__dirname, script)], { env, cwd: __dirname });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const fails = out.split('\n').filter(l => l.startsWith('FAIL'));
      const crashed = code !== 0 && fails.length === 0;
      const matched = fails.filter(l => m.expect.test(l));
      const killed = code !== 0 && (matched.length > 0 || crashed);
      resolve({ m, killed, code, crashed, fails: matched.length ? matched : fails });
    });
  });
}

(async () => {
  const wantBrowser = process.argv.includes('--browser');
  const list = M.filter(m => m.suite === 'node' || wantBrowser);
  const results = [];
  const queue = list.slice();
  const workers = Array.from({ length: wantBrowser ? 3 : 4 }, async () => {
    while (queue.length) {
      const m = queue.shift();
      const r = await run(m);
      results.push(r);
      console.log(`${r.killed ? 'KILLED  ' : 'SURVIVED'} [${m.suite}] ${m.id.padEnd(5)} ${m.what}` +
        (r.crashed ? '  (suite crashed)' : '') + (r.fails[0] ? `\n           ↳ ${r.fails[0].slice(0, 150)}` : ''));
    }
  });
  await Promise.all(workers);
  const survived = results.filter(r => !r.killed);
  console.log(`\nmutations: ${results.length}, killed: ${results.length - survived.length}, survived: ${survived.length}`);
  if (survived.length) process.exitCode = 1;
})();
