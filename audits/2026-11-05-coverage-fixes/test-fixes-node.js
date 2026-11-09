// Node unit tests for the 2026-11-05 coverage fixes (no browser needed).
// Usage: node test-fixes-node.js          (exit code 1 on any failure)
// Each block names the audit finding / decision it guards. Every check is
// written so that reverting the fix makes it fail (see mutation-check.js).
'use strict';
const { loadCoverage } = require('./load-coverage');
const { makeChecker } = require('./checker');
const { check, summary } = makeChecker();
const R = d => d * Math.PI / 180;

let api;
try {
  api = loadCoverage();
} catch (e) {
  check('coverage.js loads without p5 globals (F-10)', false, e.message);
  summary('node fix tests');
  process.exit(1);
}
check('coverage.js loads without p5 globals (F-10)', true);

// ---------------------------------------------------------------- dev tests
{
  const o = console.log, e = console.error; const fails = [];
  console.log = () => {}; console.error = (...a) => fails.push(a[0]);
  let r;
  try { r = api.__triangulationDevTests(); } catch (err) { r = { passed: 0, total: 1 }; fails.push(err.message); }
  console.log = o; console.error = e;
  check(`__triangulationDevTests all pass (${r.passed}/${r.total})`, r.passed === r.total && r.total >= 100, fails.join(' | '));
}

// ---------------------------------------------------------------- F-01 / P-03 / F-03 (direct)
{
  const S = api.STATE;
  const set = (sp, ph = [], lh = 120) => {
    S.audience.listeningHeight = lh;
    S.speakers = sp.map((p, i) => ({ id: 's' + i, name: 'S' + i, enabled: true, x: p.x, y: p.y, z: p.z, yaw: 0, pitch: 0, angleH: 90, angleV: 60 }));
    S.phantoms = ph.map((p, i) => ({ id: 'p' + i, name: 'P' + i, ...p }));
  };
  const ring = (n, r, z, ph = 0) => Array.from({ length: n }, (_, i) => ({ x: r * Math.sin(ph + 2 * Math.PI * i / n), y: r * Math.cos(ph + 2 * Math.PI * i / n), z }));
  set([...ring(8, 300, 240), ...ring(4, 200, 400, Math.PI / 4)]);
  let r = api.analyseTriangulation();
  check('F-01 all-above layout → hull-open, no scores', r.kind === 'hull-open' && !r.metrics, r.kind);
  check('F-01 hull-open panel text is the hull-open warning only',
    api.composeHealthLines(r).map(l => l.text).join('|') === '⚠ Layout doesn\'t enclose the listening centre — add a phantom above or below to close the panning grid.',
    api.composeHealthLines(r));
  set([...ring(8, 300, 120), ...ring(4, 200, 400, Math.PI / 4)], [{ x: 0, y: 0, z: -400 }]);
  r = api.analyseTriangulation();
  check('F-01 ear ring + tops + nadir → ok (encloses)', r.kind === 'ok', r.kind);
  check('F-01 enclosure tolerance is sin(1°)', Math.abs(api.HEALTH.ENCLOSE_EPS - Math.sin(R(1))) < 1e-15, api.HEALTH.ENCLOSE_EPS);
  // P-03 / B1: 1° elevation SPREAD (max − min), distance-independent.
  const elevRing = (rad, spreadDeg, base = 0) => ring(8, rad, 120).map((p, i) => ({ ...p, z: 120 + rad * Math.tan(R(base + (i % 2 ? 1 : -1) * spreadDeg / 2)) }));
  for (const rad of [120, 1200, 12000]) {
    set(elevRing(rad, 0.99));
    check(`P-03 ring with 0.99° elevation spread, r=${rad} → planar`, api.analyseTriangulation().kind === 'planar');
    set(elevRing(rad, 1.05));
    check(`P-03 ring with 1.05° elevation spread, r=${rad} → not planar`, api.analyseTriangulation().kind !== 'planar');
  }
  // B1: one ring at one height is planar whatever the elevation.
  set(ring(8, 500, 120 + 500 * Math.tan(R(14))));
  check('B1 8-ring at +14° (same height) → planar', api.analyseTriangulation().kind === 'planar', api.analyseTriangulation().kind);
  set(ring(8, 500, 120 - 500 * Math.tan(R(10))));
  check('B1 ring at −10° → planar', api.analyseTriangulation().kind === 'planar', api.analyseTriangulation().kind);
  set(elevRing(500, 0.5, 14));
  check('B1 ring at +14° with 0.5° spread → planar', api.analyseTriangulation().kind === 'planar');
  set(elevRing(500, 2, 14));
  check('B1 ring at +14° with 2° spread → not planar', api.analyseTriangulation().kind !== 'planar', api.analyseTriangulation().kind);
  set([...ring(8, 300, 120), { x: 0, y: 1, z: 500 }]);
  check('B1 ear ring + one top speaker → hull-open', api.analyseTriangulation().kind === 'hull-open', api.analyseTriangulation().kind);
  // Vertical arc in front (through the centre, not horizontal): report-only.
  set([-60, -20, 20, 60].map(a => ({ x: 0, y: 400 * Math.cos(R(a)), z: 120 + 400 * Math.sin(R(a)) })));
  check('B1 vertical front arc does not throw', (() => { try { api.analyseTriangulation(); return true; } catch (e) { return false; } })());
  console.log('INFO vertical front arc classified as: ' + api.analyseTriangulation().kind);
  // Demo files (Atmos 7.1.4) still not enclosing — covered in the browser test.
  // F-03: region by face normal; ear-level ring caps.
  check('F-03 region from normal: straight up', api.regionForDirection({ x: 0, y: 0.1, z: 0.995 }) === 'upper hemisphere');
  check('F-03 no centerline label', api.regionForDirection({ x: 0, y: 0.6, z: 0.5 }) === 'front');
  check('F-03 tie → "front and rear"', api.dominantRegion([{ level: 'red', region: 'rear' }, { level: 'red', region: 'front' }], 'red') === 'front and rear');
}

// ---------------------------------------------------------------- F-02 guard (fault injection)
{
  const g = loadCoverage();
  const S = g.STATE;
  S.speakers = [[300, 0, 120], [-300, 0, 120], [0, 300, 120], [0, -300, 120], [0, 0, 500], [0, 0, -300]]
    .map(([x, y, z], i) => ({ id: 's' + i, name: 'S' + i, enabled: true, x, y, z, yaw: 0, pitch: 0, angleH: 90, angleV: 60 }));
  check('F-02 guard: healthy octahedron → ok', g.analyseTriangulation().kind === 'ok');
  // Simulate the audit's failure mode: a hull with a duplicated directed edge.
  g.__override('buildSphericalHull', (pts) => ({ faces: [
    { a: 0, b: 2, c: 4, nx: 0, ny: 0, nz: 1 }, { a: 0, b: 2, c: 4, nx: 0, ny: 0, nz: 1 },
    { a: 2, b: 1, c: 4, nx: 0, ny: 0, nz: 1 }, { a: 1, b: 3, c: 4, nx: 0, ny: 0, nz: 1 } ] }));
  let r = g.analyseTriangulation();
  check('F-02 guard: non-manifold hull → numerical-issue, no scores', r.kind === 'numerical-issue' && !r.metrics && /appears 2×/.test(r.detail), r);
  check('F-02 guard: panel says numerical issue', /^⚠ Numerical issue/.test(g.composeHealthLines(r)[0].text));
  g.__override('buildSphericalHull', () => ({ error: 'horizon is not a single loop' }));
  r = g.analyseTriangulation();
  check('F-02 guard: failed insertion → numerical-issue', r.kind === 'numerical-issue', r.kind);
}

// ---------------------------------------------------------------- F-05 speaker basis
{
  let maxDiff = 0;
  // Reference = the pre-fix speakerBasis (forward × world-up) for |pitch| < 87.4°.
  const oldRight = (yaw, pitch) => {
    const f = [Math.sin(R(yaw)) * Math.cos(R(pitch)), Math.cos(R(yaw)) * Math.cos(R(pitch)), Math.sin(R(pitch))];
    const r = [f[1], -f[0], 0]; const m = Math.hypot(...r); return r.map(v => v / m);
  };
  for (let yaw = -180; yaw <= 180; yaw += 7.3) for (let p = -87.3; p <= 87.3; p += 0.37) {
    const b = api.speakerBasis(yaw, p); const o = oldRight(yaw, p);
    maxDiff = Math.max(maxDiff, Math.hypot(b.r.x - o[0], b.r.y - o[1], b.r.z - o[2]));
  }
  check('F-05 |pitch| < 87.4°: right vector identical to previous behaviour (K2b)', maxDiff < 1e-12, maxDiff);
  const a = api.speakerBasis(0, -90), b = api.speakerBasis(90, -90);
  check('F-05 pitch −90°: yaw 0 → right = +X', Math.abs(a.r.x - 1) < 1e-12 && Math.abs(a.r.y) < 1e-12);
  check('F-05 pitch −90°: yaw 90 → right = −Y (yaw still turns the speaker)', Math.abs(b.r.y + 1) < 1e-12 && Math.abs(b.r.x) < 1e-12, b.r);
  const u = api.speakerBasis(37, -90).u, f = api.speakerBasis(37, -90).f;
  check('F-05 basis stays orthonormal at pitch −90°', Math.abs(Math.hypot(u.x, u.y, u.z) - 1) < 1e-12 && Math.abs(u.x * f.x + u.y * f.y + u.z * f.z) < 1e-12);
  // Heatmap footprint rotates with yaw for a ceiling speaker (audit K2).
  const S = api.STATE;
  S.audience = { length: 1000, width: 1000, listeningHeight: 120 };
  const span = (yaw) => {
    S.speakers = [{ id: 's1', name: 'C', enabled: true, x: 0, y: 0, z: 600, yaw, pitch: -90, angleH: 120, angleV: 30 }];
    api.computeCoverage();
    const nx = api.COVERAGE.resX, ny = api.COVERAGE.resY; let minX = 1e9, maxX = -1e9;
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) if (api.COVERAGE.counts[iy * nx + ix]) { minX = Math.min(minX, ix); maxX = Math.max(maxX, ix); }
    return maxX - minX;
  };
  check('F-05 ceiling speaker: yaw 0 vs yaw 90 give different X spans', span(0) > 2 * span(90), [span(0), span(90)]);
}

// ---------------------------------------------------------------- F-06 filenames
{
  const S = api.STATE;
  const cases = [
    ['工作坊 7.1.4', '工作坊-7.1.4-coverage-sketch.html'],
    ['Théâtre — salle 2', 'Théâtre-—-salle-2-coverage-sketch.html'],
    ['a/b\\c:d*e?f"g<h>i|j', 'a-b-c-d-e-f-g-h-i-j-coverage-sketch.html'],
    ['..hidden', 'hidden-coverage-sketch.html'],
    ['', 'untitled-coverage-sketch.html'],
    ['   ', 'untitled-coverage-sketch.html'],
  ];
  for (const [name, want] of cases) {
    S.metadata.layoutName = name;
    check(`F-06 html filename for ${JSON.stringify(name)}`, api.htmlFilename() === want, api.htmlFilename());
  }
  S.metadata.layoutName = '';
  check('F-06 PNG uses the same lowercase "untitled"', /^untitled-coverage-\d{4}-/.test(api.pngFilename()), api.pngFilename());
  S.metadata.layoutName = '工作坊 7.1.4';
  check('F-06 PNG keeps CJK name', api.pngFilename().startsWith('工作坊-7.1.4-coverage-'), api.pngFilename());
}

// ---------------------------------------------------------------- F-16 reset + shared validation
{
  const a = loadCoverage();
  a.STATE.phantoms = [{ id: 'p1', name: 'Zenith', x: 0, y: 0, z: 500 }];
  a.STATE.speakers.push({ id: 's9', name: 'Extra', enabled: true, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, angleH: 90, angleV: 60 });
  a.STATE.view.layers.coords = true;
  a.applyLoadedState({ schemaVersion: 1, metadata: { layoutName: 'x' }, audience: { length: 600, width: 800, listeningHeight: 120 } });
  check('F-16 file without phantoms key → phantoms reset to default (none)', a.STATE.phantoms.length === 0, a.STATE.phantoms);
  check('F-16 file without speakers key → default LCR, not the previous list', a.STATE.speakers.map(s => s.name).join() === 'L,R,C');
  check('F-16 file without view → default layers', a.STATE.view.layers.coords === false);
  const b = loadCoverage();
  b.applyLoadedState({ schemaVersion: 1, audience: { length: -5, width: Infinity, listeningHeight: 0 },
    speakers: [{ id: 's1', name: 'A', x: null, y: 'abc', z: 10, yaw: 1e999, pitch: 5, angleH: 180, angleV: 0 }] });
  check('F-16 invalid audience values → defaults', b.STATE.audience.length === 600 && b.STATE.audience.width === 800 && b.STATE.audience.listeningHeight === 120, b.STATE.audience);
  const s = b.STATE.speakers[0];
  check('F-16 non-finite speaker numbers → 0', s.x === 0 && s.y === 0 && s.yaw === 0 && s.z === 10 && s.pitch === 5, s);
  check('F-19 spread 180 / 0 rejected on load → defaults 90 / 60', s.angleH === 90 && s.angleV === 60, s);
  check('F-16/F-19 shared validators', b.isValidAudienceValue(0) === false && b.isValidAudienceValue(1) === true
    && b.isValidFinite(Infinity) === false && b.isValidSpread(180) === false && b.isValidSpread(179.9) === true && b.isValidSpread(0) === false);
  // atomic: a schema error leaves STATE untouched
  const c = loadCoverage(); const before = JSON.stringify(c.STATE);
  try { c.applyLoadedState({ schemaVersion: 2 }); } catch (e) { /* expected */ }
  check('F-16 schema mismatch leaves STATE untouched', JSON.stringify(c.STATE) === before);
  // missing ids never collide with loaded ones
  const d = loadCoverage();
  d.applyLoadedState({ schemaVersion: 1, speakers: [{ name: 'noid', x: 1, y: 1, z: 1 }, { id: 's1', name: 'has', x: 2, y: 2, z: 2 }] });
  check('F-16 generated id does not collide', new Set(d.STATE.speakers.map(s => s.id)).size === 2, d.STATE.speakers.map(s => s.id));
}

// ---------------------------------------------------------------- F-17 m → cm rounding
{
  const S = api.STATE;
  S.view.unit = 'm';
  check('F-17 2.53 m → 253 cm', api.lenStore(2.53) === 253, api.lenStore(2.53));
  check('F-17 1.1 m → 110 cm', api.lenStore(1.1) === 110, api.lenStore(1.1));
  check('F-17 0.12345 m → 12.35 cm (0.01 cm)', api.lenStore(0.12345) === 12.35, api.lenStore(0.12345));
  S.view.unit = 'cm';
  check('F-17 cm input untouched', api.lenStore(12.345) === 12.345);
}

// ---------------------------------------------------------------- F-15 camera distance clamp
{
  const L = api.CAMERA_DISTANCE_LIMITS;
  check('F-15 limits 100–5000 cm', L.min === 100 && L.max === 5000, L);
  const near = api.clampCameraEye([0, 0, 130], [0, 0, 120]);
  check('F-15 eye 10 cm from centre pushed out to 100 cm', Math.abs(Math.hypot(near[0], near[1], near[2] - 120) - 100) < 1e-9, near);
  const far = api.clampCameraEye([0, -90000, 0], [0, 0, 0]);
  check('F-15 eye 900 m away pulled in to 50 m', Math.abs(Math.hypot(...far) - 5000) < 1e-9, far);
  const ok = api.clampCameraEye([700, -900, 750], [0, 0, 100]);
  check('F-15 in-range eye unchanged', ok[0] === 700 && ok[1] === -900 && ok[2] === 750);
}

// ---------------------------------------------------------------- Q-01 camera in saved state
{
  const a = loadCoverage();
  a.STATE.view.camera = { eye: [916, -1032, -35], centre: [0, 0, 200], up: [0, 0, 1] };
  const saved = JSON.parse(JSON.stringify(a.serializeState()));
  check('Q-01 serializeState writes view.camera', saved.view.camera && saved.view.camera.eye.join() === '916,-1032,-35', saved.view);
  const b = loadCoverage();
  b.applyLoadedState(saved);
  check('Q-01 applyLoadedState restores view.camera', JSON.stringify(b.STATE.view.camera) === JSON.stringify(a.STATE.view.camera), b.STATE.view.camera);
  const c = loadCoverage();
  c.applyLoadedState({ ...saved, view: { ...saved.view, camera: { eye: [0, 0, 'x'], centre: [0, 0, 0], up: [0, 0, 1] } } });
  check('Q-01 malformed camera → null (preset used)', c.STATE.view.camera === null);
  const d = loadCoverage();
  d.applyLoadedState({ ...saved, view: { ...saved.view, camera: { eye: [0, 0, 1], centre: [0, 0, 0], up: [0, 0, 1] } } });
  check('Q-01 loaded camera distance clamped to ≥ 100 cm', Math.abs(Math.hypot(...d.STATE.view.camera.eye) - 100) < 1e-9, d.STATE.view.camera);
}

// ---------------------------------------------------------------- B7 load warning (no silent value replacement)
{
  const mk = () => ({ schemaVersion: 1, audience: { length: 600, width: 800, listeningHeight: 120 },
    speakers: [{ id: 's1', name: 'Front L', x: 100, y: 200, z: 240, yaw: 0, pitch: 0, angleH: 90, angleV: 60 }], phantoms: [] });
  const warnFor = (parsed) => { const x = loadCoverage(); return x.loadWarning(x.applyLoadedState(parsed)); };
  let st = mk(); st.speakers[0].x = '5';
  const w1 = warnFor(st);
  check('B7 string x → warning naming the speaker', w1 === "⚠ 1 value(s) in this file couldn't be read and were replaced with defaults (Front L). Check them before relying on this layout.", w1);
  check('B7 healthy file → no warning', warnFor(mk()) === '');
  st = mk(); delete st.speakers[0].angleH; delete st.speakers[0].yaw; delete st.audience.width;
  check('B7 missing fields (not wrong values) → no warning', warnFor(st) === '', warnFor(st));
  st = mk(); st.speakers[0].angleH = 400; st.audience.length = NaN; st.phantoms = [{ id: 'p1', name: 'Ph', x: null, y: 0, z: 0 }];
  const w2 = warnFor(st);
  check('B7 out-of-range spread + audience + phantom → counted and deduped names',
    /^⚠ 3 value\(s\).*\(Front L, audience, Ph\)/.test(w2) || /^⚠ 3 value\(s\).*\((?:Front L|audience|Ph), /.test(w2), w2);
  st = mk(); st.speakers = Array.from({ length: 7 }, (_, i) => ({ id: 's' + i, name: 'S' + i, x: 'bad', y: 0, z: 0, yaw: 0, pitch: 0, angleH: 90, angleV: 60 }));
  const w3 = warnFor(st);
  check('B7 more than 5 names → "and K more"', w3.includes('(S0, S1, S2, S3, S4, and 2 more)') && w3.startsWith('⚠ 7 value(s)'), w3);
}

// ---------------------------------------------------------------- Q-01 / F-16 boot loader (saved file opened directly)
{
  const saved = { schemaVersion: 1, metadata: { layoutName: 'Boot' }, audience: { length: 700, width: 900, listeningHeight: 110 },
    speakers: [{ id: 's5', name: 'Only', enabled: true, x: 1, y: 2, z: 3, yaw: 4, pitch: 5, angleH: 80, angleV: 40 }], phantoms: [],
    view: { unit: 'm', cameraPreset: 'side', camera: { eye: [916, -1032, -35], centre: [0, 0, 200], up: [0, 0, 1] }, layers: { coords: true } } };
  const a = loadCoverage({ embeddedStateJson: JSON.stringify(saved) });
  check('boot loader applies the embedded state without warnings', a.bootWarnings.length === 0 && a.STATE.metadata.layoutName === 'Boot'
    && a.STATE.speakers.length === 1 && a.STATE.view.unit === 'm', a.bootWarnings);
  check('Q-01 boot loader restores the free camera', a.STATE.view.camera && a.STATE.view.camera.eye.join() === '916,-1032,-35', a.STATE.view.camera);
}

// ---------------------------------------------------------------- P-04 inline script escaping
{
  const x = api.escapeInlineScript('a</script>b</SCRIPT x<!--y');
  check('P-04 escapes </script (any case) and <!--', !/<\/script/i.test(x) && !x.includes('<!--'), x);
  check('P-04 escaping is idempotent', api.escapeInlineScript(x) === x);
  // The escaped text must still mean the same thing to JavaScript.
  const js = "var s1 = '</script>'; var s2 = `</SCRIPT${1}`; var re = /<\\/script>/; var c = '<!--';";
  const vm = require('vm'); const ctx = {}; vm.createContext(ctx);
  vm.runInContext(api.escapeInlineScript(js) + ';globalThis.out=[s1,s2,re.test("</script>"),c];', ctx);
  check('P-04 escaped JS evaluates to the same strings', JSON.stringify(ctx.out) === JSON.stringify(['</script>', '</SCRIPT1', true, '<!--']), ctx.out);
  check('P-04 </style escaped in inline CSS', !/<\/style/i.test(api.escapeInlineStyle('a{} </style><b>')));
  const src = require('fs').readFileSync(process.env.COVERAGE_JS_OVERRIDE || require('path').join(__dirname, '../../coverage/coverage.js'), 'utf8');
  check('P-04 the real coverage.js survives escaping as valid JS', (() => { try { new vm.Script(api.escapeInlineScript(src)); return true; } catch (e) { return false; } })());
}

// ---------------------------------------------------------------- F-19 title
check('F-19 live title for a named layout', api.layoutTitle('工作坊') === '工作坊 — Sound Coverage Sketch');
check('F-19 live title for an unnamed layout', api.layoutTitle('  ') === 'Sound Coverage Sketch');

summary('node fix tests');
