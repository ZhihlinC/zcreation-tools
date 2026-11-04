// Headless-Chromium tests for the 2026-11-05 coverage fixes.
// Usage: P5_LOCAL=/path/to/p5.min.js node test-fixes-browser.js
// Optional: SHOTS_DIR=<dir> also writes the screenshots listed in the report.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { serve, newPage, ready, makeChecker, ROOT, launch } = require('./browser-helpers');
const { check, summary } = makeChecker();
const SHOTS = process.env.SHOTS_DIR;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-fix-'));
const shot = async (page, name, opts = {}) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), ...opts }); };

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await launch(chromium);

  // ===================================================================== boot
  const page = await newPage(browser);
  await page.goto(base + '/coverage/');
  await ready(page);
  check('boot: no console / page errors', page.__errors.length === 0, page.__errors);
  const dev = await page.evaluate(() => { const o = console.log, e = console.error; console.log = () => {}; console.error = () => {}; const r = __triangulationDevTests(); console.log = o; console.error = e; return [r.passed, r.total]; });
  check(`__triangulationDevTests in Chromium (${dev[0]}/${dev[1]})`, dev[0] === dev[1] && dev[1] >= 100, dev);

  // ===================================================================== F-08 phantom note
  const note = await page.evaluate(() => {
    const el = document.querySelector('#phantoms-panel .panel-note');
    if (!el) return null;
    const r = el.getBoundingClientRect(), btn = document.getElementById('add-phantom-btn').getBoundingClientRect();
    const panel = document.getElementById('phantoms-panel').getBoundingClientRect();
    return { text: el.textContent.trim(), visible: getComputedStyle(el).visibility === 'visible' && r.height > 0,
             btnInside: btn.bottom <= panel.bottom + 0.5 && btn.height > 0 };
  });
  check('F-08 Phantoms panel shows the reserve-a-panning-position note',
    note && note.visible && note.text === 'Phantoms reserve a panning position on the sphere — they are not speakers to buy. Add one to see how the layout health changes when that direction is covered.', note);
  check('F-08 "+ Add Phantom" still fully visible under the note (1440×900)', note && note.btnInside, note);
  await shot(page, 'phantoms-note.png', { clip: { x: 1150, y: 700, width: 290, height: 200 } });

  // ===================================================================== Q-07a Add Speaker form
  const nBefore = await page.evaluate(() => STATE.speakers.length);
  await page.click('#add-speaker-btn');
  const form = await page.evaluate(() => {
    const d = document.getElementById('add-speaker-dialog'), f = document.getElementById('add-speaker-form');
    return { open: d.open, modal: d.matches(':modal'), values: Object.fromEntries(['name', 'x', 'y', 'z', 'yaw', 'pitch', 'angleH', 'angleV'].map(k => [k, f.elements[k].value])),
             expected: (() => { const a = aimAtCentre(0, STATE.audience.width / 2 + 200, 240); return { y: String(STATE.audience.width / 2 + 200), yaw: String(a.yaw), pitch: String(a.pitch) }; })() };
  });
  check('Q-07a "+ Add Speaker" opens a modal form (no speaker added yet)', form.open && form.modal && (await page.evaluate(() => STATE.speakers.length)) === nBefore, form);
  check('Q-07a speaker form pre-filled with defaults incl. auto-aim',
    form.values.name === `Speaker ${nBefore + 1}` && form.values.x === '0' && form.values.y === form.expected.y && form.values.z === '240'
    && form.values.yaw === form.expected.yaw && form.values.pitch === form.expected.pitch && form.values.angleH === '90' && form.values.angleV === '60', form);
  await shot(page, 'add-speaker-dialog.png');
  // auto-aim follows X/Y/Z until yaw/pitch are edited
  await page.fill('#add-speaker-form input[name="x"]', '300');
  const aimed = await page.evaluate(() => { const f = document.getElementById('add-speaker-form'); const a = aimAtCentre(300, +f.elements.y.value, +f.elements.z.value); return [f.elements.yaw.value, String(a.yaw), f.elements.pitch.value, String(a.pitch)]; });
  check('Q-07a yaw/pitch follow the position while untouched', aimed[0] === aimed[1] && aimed[2] === aimed[3], aimed);
  await page.fill('#add-speaker-form input[name="yaw"]', '12');
  await page.fill('#add-speaker-form input[name="x"]', '-300');
  check('Q-07a yaw stays as typed once edited', (await page.inputValue('#add-speaker-form input[name="yaw"]')) === '12');
  // invalid spread blocks submit
  await page.fill('#add-speaker-form input[name="angleH"]', '180');
  await page.click('#add-speaker-form [data-action="add"]');
  const blocked = await page.evaluate(() => ({ open: document.getElementById('add-speaker-dialog').open, n: STATE.speakers.length, invalid: document.querySelector('#add-speaker-form input[name="angleH"]').classList.contains('invalid') }));
  check('Q-07a / F-19 spread 180° rejected: form stays open, nothing added', blocked.open && blocked.n === nBefore && blocked.invalid, blocked);
  await page.fill('#add-speaker-form input[name="angleH"]', '100');
  await page.fill('#add-speaker-form input[name="name"]', 'Fill');
  await page.click('#add-speaker-form [data-action="add"]');
  const added = await page.evaluate(() => ({ open: document.getElementById('add-speaker-dialog').open, s: STATE.speakers[STATE.speakers.length - 1], rows: document.querySelectorAll('.speaker-item').length }));
  check('Q-07a Add closes the form and appends the speaker with the form values',
    !added.open && added.s.name === 'Fill' && added.s.x === -300 && added.s.yaw === 12 && added.s.angleH === 100 && added.rows === nBefore + 1, added);
  // cancel adds nothing
  await page.click('#add-speaker-btn');
  await page.click('#add-speaker-form [data-action="cancel"]');
  check('Q-07a Cancel adds nothing', (await page.evaluate(() => STATE.speakers.length)) === nBefore + 1);
  // metres: form shows m and stores cm (rounded, F-17)
  await page.click('#meta-panel button[data-unit="m"]');
  await page.click('#add-speaker-btn');
  const mForm = await page.evaluate(() => { const f = document.getElementById('add-speaker-form'); return { y: f.elements.y.value, tag: f.querySelector('.unit-tag').textContent }; });
  check('Q-07a form uses the display unit (m)', mForm.tag === '(m)' && mForm.y === String((await page.evaluate(() => STATE.audience.width / 2 + 200)) / 100), mForm);
  await page.fill('#add-speaker-form input[name="x"]', '2.53');
  await page.click('#add-speaker-form [data-action="add"]');
  check('F-17 2.53 m typed in the form stored as 253 cm', (await page.evaluate(() => STATE.speakers[STATE.speakers.length - 1].x)) === 253);
  await page.click('#meta-panel button[data-unit="cm"]');

  // ===================================================================== Q-07a Add Phantom form
  const pBefore = await page.evaluate(() => STATE.phantoms.length);
  await page.click('#add-phantom-btn');
  const pf = await page.evaluate(() => { const f = document.getElementById('add-phantom-form'); return { open: document.getElementById('add-phantom-dialog').open, name: f.elements.name.value, xyz: [f.elements.x.value, f.elements.y.value, f.elements.z.value], note: !!f.querySelector('.panel-note') }; });
  check('Q-07a "+ Add Phantom" opens a form with EMPTY coordinates (SPEC §8.4)', pf.open && pf.xyz.every(v => v === '') && pf.name === `Phantom ${pBefore + 1}`, pf);
  await shot(page, 'add-phantom-dialog.png');
  await page.click('#add-phantom-form [data-action="add"]');
  check('Q-07a phantom form refuses empty coordinates', (await page.evaluate(() => STATE.phantoms.length)) === pBefore && await page.evaluate(() => document.getElementById('add-phantom-dialog').open));
  await page.fill('#add-phantom-form input[name="x"]', '0');
  await page.fill('#add-phantom-form input[name="y"]', '0');
  await page.fill('#add-phantom-form input[name="z"]', '-300');
  await page.click('#add-phantom-form [data-action="add"]');
  const ph = await page.evaluate(() => STATE.phantoms[STATE.phantoms.length - 1]);
  check('Q-07a phantom added with the typed position', ph && ph.z === -300 && ph.x === 0 && ph.y === 0, ph);

  // ===================================================================== F-16 / F-19 inline input validation
  await page.locator('.speaker-item').nth(0).locator('.expand-btn').click();
  const inp = page.locator('.speaker-item').nth(0).locator('input[data-field="angleH"]');
  await inp.fill('181');
  check('F-19 inline spread 181° not stored', (await page.evaluate(() => STATE.speakers[0].angleH)) === 90);
  await inp.fill('1e999');
  check('F-16 inline Infinity not stored', (await page.evaluate(() => STATE.speakers[0].angleH)) === 90);
  await inp.blur();
  check('F-16 invalid inline value reverts on commit', (await inp.inputValue()) === '90');
  await page.fill('input[data-audience="listeningHeight"]', '0');
  check('F-16 audience listening height 0 not stored', (await page.evaluate(() => STATE.audience.listeningHeight)) === 120);
  await page.fill('input[data-audience="listeningHeight"]', '120');

  // ===================================================================== F-07 labels
  await page.locator('.speaker-item').nth(0).locator('header input[type=checkbox]').uncheck();
  await page.click('#view-controls button[data-view="top"]');
  await page.waitForTimeout(400);
  const lab = await page.evaluate(() => getComputedStyle(document.getElementById('speaker-label-s1')).visibility);
  check('F-07 disabled speaker name label hidden', lab === 'hidden', lab);
  await page.uncheck('input[data-layer="speakers"]');
  await page.waitForTimeout(400);
  const lab2 = await page.evaluate(() => getComputedStyle(document.getElementById('speaker-labels')).display);
  check('F-07 Speakers layer off hides all speaker name labels', lab2 === 'none', lab2);
  await page.check('input[data-layer="speakers"]');
  await page.locator('.speaker-item').nth(0).locator('header input[type=checkbox]').check();
  await page.waitForTimeout(400);
  check('F-07 re-enabled speaker label visible again', (await page.evaluate(() => getComputedStyle(document.getElementById('speaker-label-s1')).visibility)) === 'visible');

  // ===================================================================== F-15 zoom clamp
  // Headless software GL runs at a few fps, so wheel-spamming all the way to
  // the limits takes minutes; instead put the camera outside the limits the
  // way a wheel zoom would and let the next frames (pointer on the canvas)
  // clamp it. One real wheel step checks the clamp sits on the zoom path.
  const dist = () => page.evaluate(() => Math.hypot(cam.eyeX - cam.centerX, cam.eyeY - cam.centerY, cam.eyeZ - cam.centerZ));
  await page.mouse.move(700, 600);
  await page.evaluate(() => cam.camera(0, -30, 100, 0, 0, 100, 0, 0, 1));
  await page.waitForTimeout(800);
  const dMin = await dist();
  await page.evaluate(() => cam.camera(0, -90000, 100, 0, 0, 100, 0, 0, 1));
  await page.waitForTimeout(800);
  const dMax = await dist();
  check(`F-15 camera closer than 100 cm is pushed back to 100 cm (got ${dMin.toFixed(2)})`, Math.abs(dMin - 100) < 1e-6, dMin);
  check(`F-15 camera farther than 5000 cm is pulled in to 5000 cm (got ${dMax.toFixed(2)})`, Math.abs(dMax - 5000) < 1e-6, dMax);
  await page.mouse.wheel(0, 20000);
  await page.waitForTimeout(1500);
  const dWheel = await dist();
  check(`F-15 wheel zoom-out at the limit stays at 5000 cm (got ${dWheel.toFixed(2)})`, dWheel <= 5000 + 1e-6, dWheel);

  // ===================================================================== F-18 PNG 2× redraw
  await page.click('#view-controls button[data-view="perspective"]');
  await page.evaluate(() => {
    window.__pngSources = [];
    const orig = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) {
      if (src && src.tagName === 'CANVAS' && src.closest && src.closest('#canvas-host')) window.__pngSources.push([src.width, src.height]);
      return orig.call(this, src, ...rest);
    };
  });
  const camBefore = await page.evaluate(() => [cam.eyeX, cam.eyeY, cam.eyeZ].join());
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('#save-png-btn')]);
  const pngPath = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(pngPath);
  const buf = fs.readFileSync(pngPath);
  const pngInfo = await page.evaluate(() => ({ src: window.__pngSources, now: [document.querySelector('#canvas-host canvas').width, document.querySelector('#canvas-host canvas').height], density: pixelDensity(), cam: [cam.eyeX, cam.eyeY, cam.eyeZ].join() }));
  check('F-18 PNG is 2× the viewport (2880×1800)', buf.readUInt32BE(16) === 2880 && buf.readUInt32BE(20) === 1800, [buf.readUInt32BE(16), buf.readUInt32BE(20)]);
  check('F-18 WebGL canvas was re-rendered at 2880×1800 for the export (not upscaled)', pngInfo.src.length === 1 && pngInfo.src[0][0] === 2880 && pngInfo.src[0][1] === 1800, pngInfo);
  check('F-18 pixel density + canvas size restored after export', pngInfo.density === 1 && pngInfo.now[0] === 1440 && pngInfo.now[1] === 900, pngInfo);
  check('F-18 camera unchanged by export', pngInfo.cam === camBefore, [camBefore, pngInfo.cam]);
  check('F-06 PNG filename default is lowercase untitled', /^untitled-coverage-/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await page.context().close();

  // ===================================================================== save → reopen: F-06, Q-01, Q-07b, P-04, F-19 title
  const p2 = await newPage(browser);
  await p2.goto(base + '/coverage/');
  await ready(p2);
  await p2.fill('#layout-name', '工作坊 7.1.4');
  // orbit the camera with the mouse (free view, Q-01)
  await p2.mouse.move(700, 600); await p2.mouse.down();
  for (let i = 1; i <= 6; i++) { await p2.mouse.move(700 + i * 25, 600 + i * 5); await p2.waitForTimeout(300); }
  await p2.mouse.up(); await p2.waitForTimeout(500);
  const orbit = await p2.evaluate(() => ({ cam: [cam.eyeX, cam.eyeY, cam.eyeZ, cam.centerX, cam.centerY, cam.centerZ].map(v => Math.round(v * 1000) / 1000), state: STATE.view.camera }));
  check('Q-01 orbit drag recorded in STATE.view.camera', orbit.state && orbit.state.eye.join() === orbit.cam.slice(0, 3).join(), orbit);
  // P-04: a coverage.js that contains "</script>" must still round-trip.
  await p2.evaluate(() => {
    const realGet = getCoverageJs;
    window.getCoverageJs = async () => (await realGet()) + '\n// test: </script><script>window.__pwned = 1</script> <!-- <script>\nwindow.__p04Tail = "</script>";\n';
  });
  const [dl2] = await Promise.all([p2.waitForEvent('download'), p2.click('#save-html-btn')]);
  check('F-06 HTML filename keeps the Chinese layout name', dl2.suggestedFilename() === '工作坊-7.1.4-coverage-sketch.html', dl2.suggestedFilename());
  const saved = path.join(OUT, 'saved.html'); await dl2.saveAs(saved);
  const html = fs.readFileSync(saved, 'utf8');
  const inline = /<script id="coverage-script-inline">([\s\S]*?)<\/script>/.exec(html);
  check('P-04 inline script contains no raw "</script" or "<!--"', inline && !/<\/script/i.test(inline[1]) && !inline[1].includes('<!--'), inline && inline[1].slice(-200));
  check('P-04 inline script runs to its last line', inline && inline[1].includes('window.__p04Tail = "<\\/script>"'));
  const p3 = await newPage(browser);
  await p3.goto('file://' + saved);
  await ready(p3);
  await p3.waitForTimeout(400);
  const reopened = await p3.evaluate(() => ({ pwned: window.__pwned, tail: window.__p04Tail, cam: [cam.eyeX, cam.eyeY, cam.eyeZ, cam.centerX, cam.centerY, cam.centerZ].map(v => Math.round(v * 1000) / 1000),
    saveHidden: document.getElementById('save-html-btn').hidden, openHidden: document.getElementById('open-html-btn').hidden, errors: 0 }));
  check('P-04 saved file boots, injected script did not run', reopened.pwned === undefined && reopened.tail === '</script>' && p3.__errors.length === 0, { ...reopened, errors: p3.__errors });
  check('Q-01 file:// reopen restores the orbited camera', reopened.cam.join() === orbit.cam.join(), [orbit.cam, reopened.cam]);
  check('Q-07b saved file hides Save HTML and Open HTML', reopened.saveHidden && reopened.openHidden);
  await p3.context().close();
  // live Open HTML
  const p4 = await newPage(browser);
  await p4.goto(base + '/coverage/');
  await ready(p4);
  await p4.setInputFiles('#open-html-input', saved);
  await p4.waitForFunction(() => STATE.metadata.layoutName === '工作坊 7.1.4');
  await p4.waitForTimeout(400);
  const live = await p4.evaluate(() => ({ title: document.title, cam: [cam.eyeX, cam.eyeY, cam.eyeZ, cam.centerX, cam.centerY, cam.centerZ].map(v => Math.round(v * 1000) / 1000) }));
  check('F-19 live Open HTML updates document.title', live.title === '工作坊 7.1.4 — Sound Coverage Sketch', live.title);
  check('Q-01 live Open HTML restores the orbited camera', live.cam.join() === orbit.cam.join(), [orbit.cam, live.cam]);
  // preset click discards the free camera
  await p4.click('#view-controls button[data-view="top"]');
  await p4.waitForTimeout(300);
  check('Q-01 clicking a preset clears the free camera', (await p4.evaluate(() => STATE.view.camera)) === null);
  // F-16: opening a file without phantoms resets the phantom list
  await p4.evaluate(() => { STATE.phantoms.push({ id: 'p9', name: 'Stale', x: 0, y: 0, z: 500 }); syncUiFromState(); });
  const noPh = path.join(OUT, 'no-phantoms.html');
  const st = JSON.parse(/<script id="coverage-state" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1].replace(/\\u003c/g, '<'));
  delete st.phantoms;
  fs.writeFileSync(noPh, html.replace(/(<script id="coverage-state" type="application\/json">)[\s\S]*?(<\/script>)/, (m, a, b) => a + JSON.stringify(st).replace(/</g, '\\u003c') + b));
  await p4.setInputFiles('#open-html-input', noPh);
  await p4.waitForTimeout(500);
  check('F-16 Open of a file without "phantoms" drops the stale phantom', (await p4.evaluate(() => STATE.phantoms.length)) === 0 && (await p4.locator('.phantom-item').count()) === 0);
  await p4.context().close();

  // ===================================================================== F-10 offline
  const p5o = await newPage(browser, { offline: true });
  await p5o.goto('file://' + saved);
  await p5o.waitForTimeout(2500);
  const off = await p5o.evaluate(() => ({ p5: typeof p5 !== 'undefined', notice: !document.getElementById('offline-notice').hidden,
    text: document.getElementById('offline-notice').innerText.trim(), rows: document.querySelectorAll('.speaker-item').length,
    health: document.getElementById('health-panel-status').innerText.trim() }));
  check('F-10 offline: notice shown in the middle of the screen', !off.p5 && off.notice
    && off.text === 'The 3D view needs an internet connection to load p5.js. Your layout data in this file is intact — reconnect and reload to see the scene.', off);
  const onTop = await p5o.evaluate(() => {
    const r = document.getElementById('offline-notice').getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(hit && hit.closest('#offline-notice'));
  });
  check('F-10 offline: notice is on top (not covered by a panel)', onTop);
  check('F-10 offline: panels and Layout Health still work', off.rows > 0 && off.health.length > 0, off);
  check('F-10 offline: no "radians is not defined" error', !p5o.__errors.some(e => /radians/.test(e)), p5o.__errors);
  await shot(p5o, 'offline-notice.png');
  await p5o.context().close();

  // ===================================================================== F-01 hull-open on the Atmos demo (screenshot)
  const p6 = await newPage(browser);
  await p6.goto('file://' + path.join(ROOT, 'demo/Dolby-Atmos-7.1.4-coverage-sketch.html'));
  await ready(p6);
  await p6.waitForTimeout(600);
  const atmos = await p6.evaluate(() => ({ kind: TRIANGULATION.result && TRIANGULATION.result.kind, lines: [...document.querySelectorAll('#health-panel-status p')].map(p => p.textContent) }));
  check('F-01 Atmos 7.1.4 demo shows the hull-open warning (no triangle scores)',
    atmos.kind === 'hull-open' && atmos.lines[0] && atmos.lines[0].startsWith('⚠ Layout doesn\'t enclose the listening centre') && !atmos.lines.some(l => /triangles? detected/.test(l)), atmos);
  await shot(p6, 'hull-open-atmos-demo.png');
  await p6.context().close();

  // ===================================================================== mobile banner text
  const p7 = await newPage(browser, { viewport: { width: 800, height: 900 } });
  await p7.goto(base + '/coverage/');
  await ready(p7);
  const ban = await p7.evaluate(() => ({ shown: !document.getElementById('mobile-banner').hidden, en: document.querySelector('#mobile-banner span[lang="en"]').textContent }));
  check('mobile banner shown < 1024px with the new copy', ban.shown && /only the 3D view is shown/.test(ban.en), ban);
  await shot(p7, 'mobile-banner.png');
  await p7.context().close();

  await browser.close(); srv.close();
  summary('browser fix tests');
})().catch(e => { console.error(e); process.exit(1); });
