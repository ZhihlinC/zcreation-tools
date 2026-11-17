// Browser tests for /pdf/ (Playwright + Chromium), with real PDF files.
//   cd pdf/test && npm ci && npx playwright install chromium && node test-browser.js
// The downloaded PDF is checked by two readers: pdf.js (operator list: page
// order, shape count, no screen-only outlines) and macOS PDFKit
// (render-pdfkit.swift: pixel colours where the preview shows each shape).
// Env OVERRIDE_<FILE>=path swaps a served /pdf/<file> (used by mutation-check.js).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { serve } = require('./serve');
const { drawnPaths } = require('./oracle');

const FIX = path.join(__dirname, 'fixtures');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const fx = f => path.join(FIX, f);
let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('ok  ', name); return; }
  failed++;
  console.log('FAIL', name, detail === undefined ? '' : '— ' + detail);
}
const MARK = { 'a4-portrait.pdf': 'A', 'a4-landscape.pdf': 'B', 'b4.pdf': 'C', 'odd.pdf': 'D', 'big-150.pdf': 'P' };
const RGB = { white: [255, 255, 255], black: [0, 0, 0], red: [219, 38, 38], blue: [38, 99, 235], green: [23, 153, 69], yellow: [255, 209, 0] };
const close = (a, b, tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

// ---- page helpers ----
const order = pg => pg.evaluate(() => {
  const { S } = window.__pdfTool;
  return S.pages.map(p => S.sources.get(p.src).name + '#' + (p.index + 1));
}).then(list => list.map(s => { const [n, i] = s.split('#'); return (MARK[n] || '?') + i; }));
const cardAt = (pg, i) => pg.locator('#grid .card[data-uid]').nth(i);
const toastText = async pg => { await pg.waitForSelector('#toast:not([hidden])'); return pg.textContent('#toast'); };
async function waitThumbs(pg) {
  await pg.waitForFunction(() => [...document.querySelectorAll('#grid .card[data-uid] canvas')].slice(0, 12).every(c => c.style.visibility !== 'hidden'), null, { timeout: 15000 });
}
async function editorReady(pg) { await pg.waitForFunction(() => document.getElementById('ed-svg').dataset.ready === '1'); }
async function curPage(pg) { return pg.evaluate(() => { const { S } = window.__pdfTool; const t = document.getElementById('ed-pos').textContent; return S.pages[Number(t.split(' / ')[0]) - 1]; }); }
// display points on the open editor page → screen coordinates
async function screenPt(pg, x, y) {
  const box = await pg.locator('#ed-svg').boundingBox();
  const p = await curPage(pg);
  return [box.x + x / p.w * box.width, box.y + y / p.h * box.height];
}
async function dragPts(pg, x1, y1, x2, y2) {
  const a = await screenPt(pg, x1, y1), b = await screenPt(pg, x2, y2);
  await pg.mouse.move(a[0], a[1]); await pg.mouse.down();
  await pg.mouse.move(b[0], b[1], { steps: 6 }); await pg.mouse.up();
}
async function setStyle(pg, { tool, fill, stroke, width }) {
  if (tool) await pg.click(`#ed-tools [data-tool=${tool}]`);
  // order matters: never pass through fill=none & stroke=none
  if (stroke) await pg.click(`#ed-stroke button[data-val="${stroke}"]`);
  if (fill !== undefined) await pg.click(`#ed-fill button[data-val="${fill || ''}"]`);
  if (stroke === null) await pg.click('#ed-stroke button[data-val=""]');
  if (width) await pg.click(`#ed-width button[data-val="${width}"]`);
}
const shapesOf = (pg, i) => pg.evaluate(i => window.__pdfTool.S.pages[i].shapes, i);
// a point that must show the shape's colour, and one just outside it
function probes(s) {
  if (s.type === 'line') {
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), nx = -(s.y2 - s.y1) / len, ny = (s.x2 - s.x1) / len;
    return { inside: [mx, my, s.stroke], outside: [mx + nx * (s.width / 2 + 6), my + ny * (s.width / 2 + 6)] };
  }
  const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2), w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
  if (s.fill && s.fill !== 'white') return { inside: [x + w / 2, y + h / 2, s.fill], outside: [x - s.width - 6, y + h / 2] };
  // a white, borderless shape is invisible on a white page: nothing to sample
  // (its presence is checked through the operator list instead)
  if (!s.stroke) return null;
  // stroke-only / white fill: sample the left edge's stroke
  return { inside: [x, y + h / 2, s.stroke], outside: [x - s.width / 2 - 6, y + h / 2] };
}

// sample the editor preview (screenshot) at display points
async function previewColors(pg, pts) {
  const box = await pg.locator('#ed-page').boundingBox();
  const p = await curPage(pg);
  const png = await pg.screenshot({ clip: box });
  return pg.evaluate(async ({ b64, pts, w, h }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return pts.map(([x, y]) => Array.from(g.getImageData(Math.round(x / w * img.width), Math.round(y / h * img.height), 1, 1).data.slice(0, 3)));
  }, { b64: png.toString('base64'), pts, w: p.w, h: p.h });
}
function pdfkitColors(file, samples) {
  if (process.platform !== 'darwin') return null;
  const sj = path.join(OUT, 'samples.json');
  fs.writeFileSync(sj, JSON.stringify(samples));
  return JSON.parse(execFileSync('swift', [path.join(__dirname, 'render-pdfkit.swift'), file, sj], { encoding: 'utf8' }));
}
// dpi 0 = 原始 (the dialog's default), 300 / 600 = 圖片版
async function download(pg, name, dpi = 0, timeout = 30000) {
  await pg.click('#download-btn');
  await pg.waitForSelector('#dl-dialog[open]');
  if (dpi) await pg.check(`#dl-dialog input[value="${dpi}"]`);
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout }), pg.click('#dl-ok')]);
  const file = path.join(OUT, name);
  await dl.saveAs(file);
  return { file, suggested: dl.suggestedFilename() };
}

async function main() {
  const overrides = {};
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('OVERRIDE_')) overrides['/pdf/' + k.slice(9).toLowerCase().replace(/_js$/, '.js')] = v;
  const srv = await serve(overrides);
  const base = `http://127.0.0.1:${srv.address().port}/pdf/`;
  const browser = await chromium.launch();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    await pickerTest(browser, base);
    await flowTest(browser, base, pdfjs);
    await rotatedTest(browser, base, pdfjs);
    await rotationTest(browser, base, pdfjs);
    await adjustTest(browser, base, pdfjs);
    await errorsTest(browser, base);
    await dropGuardTest(browser, base);
    await cjkTest(browser, base);
    await loadFailureTest(browser, base);
    await rasterTest(browser, base, pdfjs);
    await uploadProgressTest(browser, base);
    await bigScrollTest(browser, base);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

async function newPage(browser, base, step = 2) {
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  pg.errors = [];
  pg.on('pageerror', e => pg.errors.push(e.message));
  pg.on('console', m => { if (/Content Security Policy|Refused to/.test(m.text())) pg.errors.push(m.text()); });
  await pg.goto(base);
  await pg.waitForFunction(() => window.__pdfTool && window.__pdfTool.editorAvailable);
  if (step === 2) await pg.click('#step2-tab'); // most tests work on the ordering grid
  return pg;
}

// Step 1 (選頁): one collapsible group per file, a checkbox per page (all
// ticked at first), a big preview that follows the focus. Un-ticking leaves
// the page out of the output; ticking again restores it in file order with
// the shapes it had.
async function pickerTest(browser, base) {
  const pg = await newPage(browser, base, 1);
  check('starts on step 1', await pg.getAttribute('#step1-tab', 'aria-pressed') === 'true' && await pg.isVisible('#empty'));
  await pg.setInputFiles('#file-input', [fx('a4-portrait.pdf'), fx('a4-landscape.pdf')]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 5);
  check('one group per file', await pg.locator('#groups .group').count() === 2);
  check('all pages ticked at first', await pg.locator('#groups .tile input:checked').count() === 5);
  const gcount = i => pg.locator('#groups .group').nth(i).locator('.gcount').textContent();
  check('group counts', (await gcount(0)) === '已選 3 / 3 頁' && (await gcount(1)) === '已選 2 / 2 頁', await gcount(0));
  const tile = (g, i) => pg.locator('#groups .group').nth(g).locator('.tile').nth(i);

  // un-tick A2: out of the output, greyed, counts follow
  await tile(0, 1).locator('input').click();
  check('un-ticked page leaves the output', (await order(pg)).join() === 'A1,A3,B1,B2', (await order(pg)).join());
  check('un-ticked page greyed', await tile(0, 1).evaluate(e => e.classList.contains('off')));
  check('status counts picked pages', (await pg.textContent('#status')).includes('已選 4 頁'), await pg.textContent('#status'));
  // preview follows a click, arrow keys move it, space toggles
  await tile(1, 0).click();
  await pg.waitForFunction(() => document.getElementById('pv-canvas').dataset.key && document.getElementById('pv-label').textContent.includes('a4-landscape.pdf · 第 1 頁'));
  check('preview shows the clicked page', (await pg.textContent('#pv-label')).startsWith('a4-landscape.pdf · 第 1 頁'));
  await pg.keyboard.press('ArrowLeft');
  check('arrow key moves the preview', (await pg.textContent('#pv-label')).startsWith('a4-portrait.pdf · 第 3 頁'), await pg.textContent('#pv-label'));
  await pg.keyboard.press('ArrowLeft');
  await pg.keyboard.press(' ');
  check('space re-ticks the focused page, back in file order', (await order(pg)).join() === 'A1,A2,A3,B1,B2', (await order(pg)).join());
  await pg.keyboard.press('Control+z');
  check('undo works in step 1', (await order(pg)).join() === 'A1,A3,B1,B2' && (await toastText(pg)).includes('已復原：選回'), (await order(pg)).join());
  // 全不選 / 全選 per group
  await pg.locator('#groups .group').nth(1).locator('[data-all="0"]').click();
  check('全不選 drops the whole file', (await order(pg)).join() === 'A1,A3', (await order(pg)).join());
  await pg.locator('#groups .group').nth(1).locator('[data-all="1"]').click();
  check('全選 brings it back', (await order(pg)).join() === 'A1,A3,B1,B2', (await order(pg)).join());
  // fold a group; collapse / reopen the preview
  await pg.locator('#groups .group').nth(0).locator('.fold').click();
  check('folding hides the tiles', !(await tile(0, 0).isVisible()));
  const handle = async () => { const b = await pg.locator('#pv-toggle').boundingBox(); return [Math.round(b.x + b.width), Math.round(b.y)]; };
  const openAt = await handle();
  await pg.click('#pv-toggle');
  check('preview can be closed', !(await pg.isVisible('#preview')) && await pg.getAttribute('#pv-toggle', 'aria-expanded') === 'false');
  check('the handle stays in the same place', JSON.stringify(await handle()) === JSON.stringify(openAt), `${await handle()} vs ${openAt}`);
  await pg.click('#pv-toggle');
  check('and reopened', await pg.isVisible('#preview'));
  await pg.locator('#groups .group').nth(0).locator('.fold').click();

  // shapes survive un-tick / re-tick: draw on B1 in step 2, un-tick and re-tick it in step 1
  await pg.click('#step2-tab');
  check('step 2 shows only picked pages', await pg.locator('#grid .card[data-uid]').count() === 4);
  await cardAt(pg, 2).dblclick();
  await editorReady(pg);
  await dragPts(pg, 100, 100, 300, 200);
  await pg.keyboard.press('Escape');
  await pg.click('#step1-tab');
  await tile(1, 0).locator('input').click();
  await tile(1, 0).locator('input').click();
  const b1 = await pg.evaluate(() => window.__pdfTool.S.pages.find(p => window.__pdfTool.S.sources.get(p.src).name === 'a4-landscape.pdf' && p.index === 0));
  check('re-ticked page keeps its shapes', b1 && b1.shapes.length === 1, JSON.stringify(b1 && b1.shapes));
  check('no page errors (picker)', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.close();
}

// DoD #1–#3: two PDFs → delete, duplicate, reorder, interleave → four shapes
// on an A4 landscape and an A4 portrait page → download; Ctrl+Z after each.
async function flowTest(browser, base, pdfjs) {
  const pg = await newPage(browser, base);
  check('empty state shown at start', await pg.isVisible('#empty'));
  await pg.setInputFiles('#file-input', [fx('a4-portrait.pdf'), fx('a4-landscape.pdf')]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 5);
  check('empty state hidden with pages', !(await pg.isVisible('#empty')));
  check('loaded order', (await order(pg)).join() === 'A1,A2,A3,B1,B2', (await order(pg)).join());
  await waitThumbs(pg); // pdf.js has had the buffers; download must still work later

  // delete A2 + undo
  await cardAt(pg, 1).click();
  await pg.keyboard.press('Delete');
  check('delete page', (await order(pg)).join() === 'A1,A3,B1,B2', (await order(pg)).join());
  await pg.keyboard.press('Control+z');
  check('undo delete', (await order(pg)).join() === 'A1,A2,A3,B1,B2', (await order(pg)).join());
  check('undo toast names the action', (await toastText(pg)).includes('已復原：刪除 1 頁'));
  await cardAt(pg, 1).click();
  await pg.click('#delete-btn');

  // duplicate A3 + undo
  await cardAt(pg, 1).click();
  await pg.click('#dup-btn');
  check('duplicate lands right after', (await order(pg)).join() === 'A1,A3,A3,B1,B2', (await order(pg)).join());
  check('copy is the new selection', await cardAt(pg, 2).evaluate(e => e.classList.contains('selected')) && !(await cardAt(pg, 1).evaluate(e => e.classList.contains('selected'))));
  await pg.keyboard.press('Control+z');
  check('undo duplicate', (await order(pg)).join() === 'A1,A3,B1,B2', (await order(pg)).join());
  await cardAt(pg, 1).click();
  await pg.click('#dup-btn');

  // drag B2 to the front (mixes the two files) + undo
  const src = await cardAt(pg, 4).boundingBox(), dst = await cardAt(pg, 0).boundingBox();
  await pg.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(dst.x + 10, dst.y + dst.height / 2, { steps: 12 });
  await pg.mouse.up();
  check('drag reorder', (await order(pg)).join() === 'B2,A1,A3,A3,B1', (await order(pg)).join());
  await pg.keyboard.press('Control+z');
  check('undo reorder (one step)', (await order(pg)).join() === 'A1,A3,A3,B1,B2', (await order(pg)).join());
  await pg.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(dst.x + 10, dst.y + dst.height / 2, { steps: 12 });
  await pg.mouse.up();
  check('final order', (await order(pg)).join() === 'B2,A1,A3,A3,B1', (await order(pg)).join());

  // ---- shapes on B2 (A4 landscape)
  await cardAt(pg, 0).dblclick();
  await editorReady(pg);
  // default style: white fill, no border → fill 無 disabled (no invisible shapes)
  check('fill-none disabled while stroke is none', await pg.isDisabled('#ed-fill button[data-val=""]'));
  check('white hint shown', await pg.isVisible('#ed-hint'));
  await setStyle(pg, { tool: 'rect', stroke: 'black', width: '2' });
  check('fill-none enabled once stroke set', !(await pg.isDisabled('#ed-fill button[data-val=""]')));
  await setStyle(pg, { fill: 'green' });
  await dragPts(pg, 60, 80, 220, 160);
  await setStyle(pg, { tool: 'rrect', stroke: 'red', width: '4', fill: null });
  await dragPts(pg, 300, 60, 460, 200);
  await setStyle(pg, { tool: 'ellipse', stroke: 'blue', fill: 'yellow', width: '1' });
  await dragPts(pg, 520, 80, 760, 240);
  await setStyle(pg, { tool: 'line', stroke: 'red', width: '8' });
  await dragPts(pg, 80, 400, 700, 470);
  let sh = await shapesOf(pg, 0);
  check('four shapes on B2', sh.length === 4 && sh.map(s => s.type).join() === 'rect,rrect,ellipse,line', sh.map(s => s.type).join());

  // undo: add / move / resize / delete each restore in one Ctrl+Z
  await setStyle(pg, { tool: 'rect', fill: 'white', stroke: null });
  await dragPts(pg, 100, 300, 200, 350);
  check('add shape', (await shapesOf(pg, 0)).length === 5);
  await pg.keyboard.press('Control+z');
  check('undo add shape', (await shapesOf(pg, 0)).length === 4);
  const before = (await shapesOf(pg, 0))[0];
  await dragPts(pg, 140, 120, 240, 170); // move the green rect by (100, 50)
  const moved = (await shapesOf(pg, 0))[0];
  check('move shape', Math.abs(moved.x1 - before.x1 - 100) < 1 && Math.abs(moved.y1 - before.y1 - 50) < 1, JSON.stringify(moved));
  await pg.keyboard.press('Control+z');
  const back = (await shapesOf(pg, 0))[0];
  check('undo move (one step)', Math.abs(back.x1 - before.x1) < 0.01 && Math.abs(back.y1 - before.y1) < 0.01, JSON.stringify(back));
  await pg.click('#ed-tools [data-tool=select]');
  await (async () => { const [x, y] = await screenPt(pg, 140, 120); await pg.mouse.click(x, y); })();
  await dragPts(pg, before.x2, before.y2, before.x2 + 40, before.y2 + 30); // br handle
  check('resize shape', Math.abs((await shapesOf(pg, 0))[0].x2 - before.x2 - 40) < 1);
  await pg.keyboard.press('Control+z');
  check('undo resize', Math.abs((await shapesOf(pg, 0))[0].x2 - before.x2) < 0.01);
  await (async () => { const [x, y] = await screenPt(pg, 140, 120); await pg.mouse.click(x, y); })();
  await pg.keyboard.press('Delete');
  check('delete shape', (await shapesOf(pg, 0)).length === 3);
  await pg.keyboard.press('Control+z');
  check('undo delete shape', (await shapesOf(pg, 0)).length === 4);

  sh = await shapesOf(pg, 0);
  const prevB2 = await previewColors(pg, sh.filter(probes).flatMap(s => { const p = probes(s); return [p.inside.slice(0, 2), p.outside]; }));

  // ---- next page: A1 (A4 portrait)
  await pg.keyboard.press('PageDown');
  await editorReady(pg);
  check('PageDown moves to page 2', (await pg.textContent('#ed-pos')).startsWith('2 /'));
  await setStyle(pg, { tool: 'rect', fill: 'white', stroke: null });
  await dragPts(pg, 50, 100, 300, 160); // white, no border: the common "cover" case
  await setStyle(pg, { tool: 'rrect', stroke: 'black', fill: 'red', width: '2' });
  await dragPts(pg, 60, 250, 260, 330);
  await setStyle(pg, { tool: 'ellipse', stroke: 'green', fill: null, width: '8' });
  await dragPts(pg, 300, 250, 520, 420);
  await setStyle(pg, { tool: 'line', stroke: 'blue', width: '4' });
  await dragPts(pg, 60, 600, 520, 520);
  const shA1 = await shapesOf(pg, 1);
  check('four shapes on A1', shA1.length === 4);
  const outlines = await pg.locator('#ed-svg .ghost-outline').count();
  check('white borderless shape has a screen-only outline', outlines >= 1, outlines);
  const prevA1 = await previewColors(pg, shA1.filter(probes).flatMap(s => { const p = probes(s); return [p.inside.slice(0, 2), p.outside]; }));

  // ---- page 3 (A3, first copy) gets one shape; page 4 (A3 copy) none
  await pg.keyboard.press('PageDown');
  await editorReady(pg);
  await setStyle(pg, { tool: 'rect', fill: 'blue', stroke: null });
  await dragPts(pg, 100, 100, 300, 200);
  await pg.keyboard.press('Escape');
  check('Esc closes the editor', await pg.isHidden('#editor'));

  // ---- download and check with two readers
  const { file, suggested } = await download(pg, 'flow.pdf');
  check('download name for two sources', suggested === 'a4-landscape-合併.pdf', suggested);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  check('output page count', doc.numPages === 5, doc.numPages);
  const marks = [];
  const counts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    marks.push((await p.getTextContent()).items.map(t => t.str).join(''));
    counts.push(drawnPaths(pdfjs, await p.getOperatorList()).length);
  }
  check('output order', marks.join() === 'B2,A1,A3,A3,B1', marks.join());
  check('shape count per page (no outlines, copy isolated)', counts.join() === '4,4,1,0,0', counts.join());

  const samples = [];
  const want = [];
  const add = (page, s, pr, prev, k) => {
    const pw = page.w, ph = page.h;
    samples.push({ page: page.n, x: pr.inside[0] / pw, y: pr.inside[1] / ph }, { page: page.n, x: pr.outside[0] / pw, y: pr.outside[1] / ph });
    want.push({ label: `p${page.n} ${s.type}`, color: RGB[pr.inside[2]], prevIn: prev[k * 2], prevOut: prev[k * 2 + 1] });
  };
  const pB2 = { n: 1, w: 841.89, h: 595.28 }, pA1 = { n: 2, w: 595.28, h: 841.89 };
  sh.filter(probes).forEach((s, k) => add(pB2, s, probes(s), prevB2, k));
  shA1.filter(probes).forEach((s, k) => add(pA1, s, probes(s), prevA1, k));
  // copy isolation by pixels: where page 3 has its blue rect, page 4 is white
  samples.push({ page: 3, x: 200 / 595.28, y: 150 / 841.89 }, { page: 4, x: 200 / 595.28, y: 150 / 841.89 });
  const kit = pdfkitColors(file, samples);
  if (!kit) { console.log('skip PDFKit checks (not macOS)'); }
  else {
    want.forEach((w, k) => {
      const kin = kit[k * 2].rgb, kout = kit[k * 2 + 1].rgb;
      check(`${w.label} preview inside = shape colour`, close(w.prevIn, w.color), `${w.prevIn} vs ${w.color}`);
      check(`${w.label} PDFKit inside = shape colour`, close(kin, w.color), `${kin} vs ${w.color}`);
      check(`${w.label} PDFKit outside = preview outside`, close(kout, w.prevOut, 60) && !close(kout, w.color, 20), `${kout} vs preview ${w.prevOut}`);
    });
    const n = want.length * 2;
    check('PDFKit: copy page 3 has the blue rect', close(kit[n].rgb, RGB.blue), kit[n].rgb);
    check('PDFKit: duplicate page 4 does not', close(kit[n + 1].rgb, RGB.white), kit[n + 1].rgb);
  }

  // delete everything → empty state again; leaving warns while not downloaded
  await pg.keyboard.press('Control+a');
  await pg.keyboard.press('Delete');
  check('step-2 hint after deleting all (files stay in step 1)', await pg.isVisible('#grid-empty') && !(await pg.isVisible('#empty')));
  check('download disabled when empty', await pg.isDisabled('#download-btn'));
  const leaving = () => pg.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  check('no leave warning when there are no pages', !(await leaving()));
  await pg.keyboard.press('Control+z');
  check('leave warning with pages not downloaded since the last change', await leaving());
  check('no page errors (flow)', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.close();
}

// DoD #2 on rotated / offset-CropBox pages: preview vs PDFKit
async function rotatedTest(browser, base) {
  const pg = await newPage(browser, base);
  await pg.setInputFiles('#file-input', [fx('odd.pdf'), fx('b4.pdf')]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 6);
  const pagesToDo = [0, 3, 4, 5]; // D1 rot90, D4 rot270+crop, D5 rot180, C1 B4
  const all = [];
  for (const i of pagesToDo) {
    await cardAt(pg, i).dblclick();
    await editorReady(pg);
    await setStyle(pg, { tool: 'rect', stroke: 'black', fill: 'red', width: '2' });
    await dragPts(pg, 40, 60, 200, 140);
    await setStyle(pg, { tool: 'ellipse', stroke: 'blue', fill: null, width: '8' });
    await dragPts(pg, 230, 60, 380, 200);
    const sh = await shapesOf(pg, i);
    const page = await curPage(pg);
    const prev = await previewColors(pg, sh.filter(probes).flatMap(s => { const p = probes(s); return [p.inside.slice(0, 2), p.outside]; }));
    sh.filter(probes).forEach((s, k) => all.push({ n: i + 1, page, s, pr: probes(s), prevIn: prev[k * 2], prevOut: prev[k * 2 + 1] }));
    await pg.keyboard.press('Escape');
  }
  const { file } = await download(pg, 'rotated.pdf');
  const kit = pdfkitColors(file, all.flatMap(a => [
    { page: a.n, x: a.pr.inside[0] / a.page.w, y: a.pr.inside[1] / a.page.h },
    { page: a.n, x: a.pr.outside[0] / a.page.w, y: a.pr.outside[1] / a.page.h }]));
  if (!kit) { console.log('skip PDFKit checks (not macOS)'); return pg.close(); }
  all.forEach((a, k) => {
    const color = RGB[a.pr.inside[2]];
    check(`rot${a.page.rotate} p${a.n} ${a.s.type} preview = PDFKit (inside)`, close(a.prevIn, color) && close(kit[k * 2].rgb, color), `${a.prevIn} / ${kit[k * 2].rgb} vs ${color}`);
    check(`rot${a.page.rotate} p${a.n} ${a.s.type} PDFKit outside clean`, !close(kit[k * 2 + 1].rgb, color, 20), kit[k * 2 + 1].rgb);
  });
  check('no page errors (rotated)', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.close();
}

// 「向右轉」: the page turns 90° clockwise per press, its shapes turn with it
// (so they stay on the same content), and both outputs carry the rotation.
// Independent check: in the output, the shape's user-space box must still
// contain the page's text marker, wherever the rotation puts them on screen.
async function rotationTest(browser, base, pdfjs) {
  const pg = await newPage(browser, base);
  await pg.setInputFiles('#file-input', [fx('a4-landscape.pdf')]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 2);
  await waitThumbs(pg);
  // a red box over B1's "B1" marker (display 40..110 × 45..85 on the landscape page)
  await cardAt(pg, 0).dblclick();
  await editorReady(pg);
  await setStyle(pg, { tool: 'rect', stroke: 'black', fill: 'red', width: '2' });
  await dragPts(pg, 30, 40, 120, 100);
  await pg.keyboard.press('Escape');
  const before = await shapesOf(pg, 0);
  await cardAt(pg, 0).click();
  await pg.click('#rotate-btn');
  const after = await pg.evaluate(() => { const p = window.__pdfTool.S.pages[0]; return { w: p.w, h: p.h, rot: p.rot, rotate: p.rotate, s: p.shapes[0] }; });
  check('rotate swaps the page size', Math.round(after.w) === 595 && Math.round(after.h) === 842 && after.rot === 90, JSON.stringify(after));
  const sheet = await cardAt(pg, 0).locator('.sheet').boundingBox();
  check('thumbnail turns portrait', sheet.height > sheet.width, JSON.stringify(sheet));
  await pg.waitForFunction(() => [...document.querySelectorAll('#grid .card[data-uid] canvas')][0].style.visibility !== 'hidden');
  await pg.keyboard.press('Control+z');
  check('undo rotate', JSON.stringify(await shapesOf(pg, 0)) === JSON.stringify(before) && await pg.evaluate(() => !window.__pdfTool.S.pages[0].rot));
  await cardAt(pg, 0).click();
  await pg.keyboard.press('r');
  check('R key rotates too', await pg.evaluate(() => window.__pdfTool.S.pages[0].rot) === 90);
  // the editor shows the turned page: open it and check the red box is where the state says
  await cardAt(pg, 0).dblclick();
  await editorReady(pg);
  const p0 = await curPage(pg);
  check('editor shows the turned page', Math.round(p0.w) === 595 && Math.round(p0.h) === 842);
  await pg.keyboard.press('Escape');
  await cardAt(pg, 1).click();
  await pg.keyboard.press('r'); // B2 turned too, no shapes: its marker shows where content went

  // original output: /Rotate 90, and the box still covers the "B1" text
  const { file } = await download(pg, 'rotated-vector.pdf');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const p1 = await doc.getPage(1);
  check('original output page is rotated 90', p1.rotate === 90, p1.rotate);
  const text = (await p1.getTextContent()).items.find(t => t.str === 'B1');
  const box = drawnPaths(pdfjs, await p1.getOperatorList())[0];
  const [tx, ty] = [text.transform[4] + 5, text.transform[5] + 5]; // a point inside the glyphs, user space
  check('box still covers the B1 marker after rotating', box && tx > box.bbox[0] && tx < box.bbox[2] && ty > box.bbox[1] && ty < box.bbox[3], JSON.stringify({ tx, ty, box: box && box.bbox }));
  // image output: page is portrait, red where the editor showed the box
  const { file: img } = await download(pg, 'rotated-300.pdf', 300);
  const idoc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(img)), verbosity: 0 }).promise;
  const ip = await idoc.getPage(1);
  check('image output page is portrait', Math.round(ip.view[2]) === 595 && Math.round(ip.view[3]) === 842 && ip.rotate === 0, JSON.stringify(ip.view));
  const s = after.s;
  const kit = pdfkitColors(img, [{ page: 1, x: ((s.x1 + s.x2) / 2) / 595.28, y: ((s.y1 + s.y2) / 2) / 841.89 }]);
  if (kit) check('image output: red box burned in where the editor shows it', close(kit[0].rgb, RGB.red), kit[0].rgb);
  // the page content itself is turned: B2's marker, located in the original
  // output by pdf.js, is dark in the image output at the same display spot
  const v2 = await doc.getPage(2);
  const t2 = (await v2.getTextContent()).items.find(t => t.str === 'B2');
  const [dx, dy] = v2.getViewport({ scale: 1 }).convertToViewportPoint(t2.transform[4], t2.transform[5]);
  const pts = [];
  for (let a = -12; a <= 12; a += 4) for (let b = -12; b <= 12; b += 4) pts.push({ page: 2, x: (dx + a) / 595.28, y: (dy + b) / 841.89 });
  const k2 = pdfkitColors(img, pts);
  if (k2) check('image output: page content turned with the page', k2.some(c => c.rgb[0] + c.rgb[1] + c.rgb[2] < 300), `at display ${dx.toFixed(0)},${dy.toFixed(0)}`);
  check('no page errors (rotation)', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.close();
}

// 頁面調整 (縮放 / 白邊) from the UI through both outputs. The original
// output's text position (checked against the maths in test-assemble.js) is
// the oracle: the image version must show the marker at that same spot, and
// the white band must hide what used to be at the edge.
async function adjustTest(browser, base, pdfjs) {
  const pg = await newPage(browser, base);
  await pg.setInputFiles('#file-input', [fx('a4-portrait.pdf')]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 3);
  await waitThumbs(pg);
  const set = (id, v) => pg.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  await cardAt(pg, 0).click();
  await pg.click('#adjust-btn');
  check('adjust panel opens for the selection', await pg.isVisible('#adjust') && (await pg.textContent('#adj-for')).includes('1 頁'));
  await set('adj-zoom', -10);
  await set('adj-margin', 8);
  const st = await pg.evaluate(() => window.__pdfTool.S.pages.map(p => [p.zoom || 0, p.margin || 0]).join('|'));
  check('values land on the selected page only', st === '-10,8|0,0|0,0', st);
  check('card shows the adjustment', (await cardAt(pg, 0).locator('.adj').textContent()) === '縮放 -10%・白邊 8%');
  await pg.click('#adj-close');
  check('panel closes', await pg.isHidden('#adjust'));
  await pg.keyboard.press('Control+z');
  check('undo one slider change', await pg.evaluate(() => window.__pdfTool.S.pages[0].margin || 0) === 0 && await pg.evaluate(() => window.__pdfTool.S.pages[0].zoom) === -10);
  await cardAt(pg, 0).click();
  await pg.click('#adjust-btn');
  await set('adj-margin', 8);
  await pg.click('#adj-close');

  const { file } = await download(pg, 'adjust-vector.pdf');
  const vdoc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const v1 = await vdoc.getPage(1);
  const t = (await v1.getTextContent()).items.find(i => i.str === 'A1');
  check('original output: text moved toward the centre (zoom −10%)', near(t.transform[4], 297.64 + 0.9 * (40 - 297.64), 0.1), t.transform[4]);
  const [dx, dy] = v1.getViewport({ scale: 1 }).convertToViewportPoint(t.transform[4], t.transform[5]);
  const { file: img } = await download(pg, 'adjust-300.pdf', 300);
  const pts = [];
  for (let a = 0; a <= 16; a += 4) for (let b = -16; b <= 0; b += 4) pts.push({ page: 1, x: (dx + a) / 595.28, y: (dy + b) / 841.89 });
  // the frame line (x=10 in the source) sits at x≈38.8 after −10%; the 8% band
  // (47.6 pt) covers it on p1 — only the band can make that spot white
  pts.push({ page: 1, x: (297.64 + 0.9 * (10.5 - 297.64)) / 595.28, y: 0.5 }, { page: 2, x: 10.5 / 595.28, y: 0.5 });
  const kit = pdfkitColors(img, pts);
  if (kit) {
    const n = pts.length;
    check('image output: marker where the original output has it', kit.slice(0, n - 2).some(c => c.rgb[0] + c.rgb[1] + c.rgb[2] < 300), `display ${dx.toFixed(0)},${dy.toFixed(0)}`);
    check('image output: white band hides the (zoomed) frame line', close(kit[n - 2].rgb, RGB.white, 3), kit[n - 2].rgb);
    check('image output: unadjusted page keeps its edge (control)', !close(kit[n - 1].rgb, RGB.white, 3), kit[n - 1].rgb);
  }
  check('no page errors (adjust)', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.close();
}

// DoD #4: encrypted files → zh-TW message, tool keeps working
async function errorsTest(browser, base) {
  const pg = await newPage(browser, base);
  const file = f => ({ name: f, mimeType: 'application/pdf', buffer: fs.readFileSync(fx(f)) });
  await pg.setInputFiles('#file-input', [file('encrypted-user.pdf'), file('encrypted-owner-only.pdf'), file('a4-portrait.pdf'),
    { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('just some text') }]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 3);
  await pg.waitForSelector('#errors:not([hidden])');
  const t = await pg.textContent('#errors');
  check('user-password message', t.includes('encrypted-user.pdf：不支援有密碼保護的 PDF（需要開啟密碼）'), t);
  check('owner-only message', t.includes('encrypted-owner-only.pdf：不支援有密碼保護的 PDF（這個檔案設了權限密碼）'), t);
  check('not-a-PDF message', t.includes('notes.pdf：不是 PDF 檔'), t);
  const { suggested } = await download(pg, 'after-errors.pdf');
  // undo of an add removes exactly that file's pages
  await pg.setInputFiles('#file-input', [fx('b4.pdf')]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 4);
  await pg.keyboard.press('Control+z');
  check('undo add file', (await order(pg)).join() === 'A1,A2,A3' && (await toastText(pg)).includes('加入 b4.pdf'), (await order(pg)).join());
  // a duplicate's shapes are its own: no undo in between (undo restores
  // deep copies, which would hide a shared array)
  await cardAt(pg, 0).dblclick();
  await editorReady(pg);
  await dragPts(pg, 50, 50, 150, 120);
  await pg.keyboard.press('Escape');
  await cardAt(pg, 0).click();
  await pg.click('#dup-btn');
  await cardAt(pg, 1).dblclick();
  await editorReady(pg);
  await dragPts(pg, 200, 200, 300, 300);
  await pg.keyboard.press('Escape');
  const counts = await pg.evaluate(() => window.__pdfTool.S.pages.slice(0, 2).map(p => p.shapes.length).join());
  check('shapes added to a duplicate stay off the original', counts === '1,2', counts);
  check('tool still works after errors', suggested === 'a4-portrait-整理.pdf', suggested);
  check('no page errors (errors)', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.close();
}

// A PDF dropped anywhere is added, never opened by the browser
async function dropGuardTest(browser, base) {
  const pg = await newPage(browser, base);
  const b64 = fs.readFileSync(fx('b4.pdf')).toString('base64');
  const r = await pg.evaluate(b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'dropped.pdf', { type: 'application/pdf' }));
    const fire = (type, el) => { const e = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; };
    const target = document.getElementById('toolbar'); // not the drop zone
    fire('dragenter', target);
    const overlay = !document.getElementById('drop-overlay').hidden;
    return { over: fire('dragover', target), overlay, drop: fire('drop', target) };
  }, b64);
  check('dragover default prevented anywhere', r.over);
  check('drop overlay shown while dragging', r.overlay);
  check('drop default prevented anywhere', r.drop);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 1);
  check('dropped file added', true);
  await pg.close();
}

// Non-embedded CJK font renders (needs vendored cmaps)
async function cjkTest(browser, base) {
  const pg = await newPage(browser, base);
  await pg.setInputFiles('#file-input', [fx('cjk-nonembedded.pdf')]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 1);
  await waitThumbs(pg);
  const dark = await pg.evaluate(() => {
    const c = document.querySelector('#grid .card[data-uid] canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 200) n++;
    return n;
  });
  check('non-embedded CJK text renders in the thumbnail', dark > 50, `${dark} dark px`);
  // annotations are not carried into the output, so the preview must not show
  // them either: leaks.pdf p1 has a solid black stamp at (300,700)-(400,720)
  await pg.setInputFiles('#file-input', [fx('leaks.pdf')]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 5);
  await waitThumbs(pg);
  const stampDark = await pg.evaluate(() => {
    const c = document.querySelectorAll('#grid .card[data-uid] canvas')[1];
    const k = c.width / 595.28;
    const d = c.getContext('2d').getImageData(Math.round(310 * k), Math.round(125 * k), Math.max(1, Math.round(80 * k)), Math.max(1, Math.round(14 * k))).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 150) n++;
    return n;
  });
  check('annotations are not drawn in the preview (output drops them)', stampDark === 0, `${stampDark} dark px in the stamp area`);
  await pg.close();
}

// Big uploads: the pdf-lib parse runs in the worker (never on the page's
// thread), and the loading card shows stages with a progress bar.
async function uploadProgressTest(browser, base) {
  const pg = await newPage(browser, base);
  await pg.evaluate(() => {
    window.__mainLoads = 0;
    const L = window.PDFLib.PDFDocument;
    const orig = L.load.bind(L);
    L.load = (...a) => { window.__mainLoads++; return orig(...a); };
    window.__stages = new Set();
    window.__bars = 0;
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('.card.loading')) {
        window.__stages.add(el.querySelector('.stage').textContent.replace(/\d+\/\d+/, 'n/N'));
        if (el.querySelector('progress')) window.__bars++;
      }
    }).observe(document.getElementById('grid'), { subtree: true, childList: true, characterData: true });
  });
  await pg.setInputFiles('#file-input', [fx('big-150.pdf')]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 150, null, { timeout: 30000 });
  const r = await pg.evaluate(() => ({ loads: window.__mainLoads, stages: [...window.__stages], bars: window.__bars }));
  check('upload check does not parse on the page thread', r.loads === 0, r.loads);
  check('loading card shows the stages', ['檢查檔案…', '準備頁面 n/N'].every(t => r.stages.includes(t)), r.stages.join(' | '));
  check('loading card has a progress bar', r.bars > 0, r.bars);
  check('no loading card left behind', await pg.locator('.card.loading').count() === 0);
  // the download is assembled in the worker too
  const { suggested } = await download(pg, 'big-original.pdf');
  check('download assembled off the page thread', suggested === 'big-150-整理.pdf' && await pg.evaluate(() => window.__mainLoads) === 0, suggested);
  await pg.close();
}

// Worker script missing → visible load-failure banner
async function loadFailureTest(browser, base) {
  const pg = await browser.newPage();
  await pg.route('**/vendor/pdf.worker.min.js', r => r.fulfill({ status: 404, body: '' }));
  await pg.goto(base);
  await pg.waitForSelector('#load-failed:not([hidden])', { timeout: 8000 }).catch(() => {});
  check('load-failure banner when worker is missing', await pg.isVisible('#load-failed'));
  await pg.close();
  const pg2 = await browser.newPage();
  await pg2.route('**/pdf-worker.js', r => r.fulfill({ status: 404, body: '' }));
  await pg2.goto(base);
  await pg2.waitForSelector('#load-failed:not([hidden])', { timeout: 8000 }).catch(() => {});
  check('load-failure banner when the pdf-lib worker is missing', await pg2.isVisible('#load-failed'));
  await pg2.close();
}

// 圖片版 (image version): one image per page at the chosen dpi, page size =
// what the preview showed (rotation applied), shapes burned into the pixels,
// no text and nothing else carried over. The default stays the vector output.
async function rasterTest(browser, base, pdfjs) {
  const pg = await newPage(browser, base);
  await pg.setInputFiles('#file-input', [fx('a4-landscape.pdf'), fx('odd.pdf'), fx('leaks.pdf')]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 11);
  // B1: white borderless box over its "B1" marker (40..110, 40..90 display pt);
  // D1 (/Rotate 90): a red box
  await cardAt(pg, 0).dblclick();
  await editorReady(pg);
  await setStyle(pg, { tool: 'rect', fill: 'white', stroke: null });
  await dragPts(pg, 30, 40, 120, 100);
  await pg.keyboard.press('PageDown'); await pg.keyboard.press('PageDown');
  await editorReady(pg);
  await setStyle(pg, { tool: 'rect', stroke: 'black', fill: 'red', width: '2' });
  await dragPts(pg, 100, 150, 300, 260);
  const d1 = await curPage(pg);
  await pg.keyboard.press('Escape');

  // the dialog opens with 原始 selected
  await pg.click('#download-btn');
  check('download dialog defaults to the original', await pg.isChecked('#dl-dialog input[value="0"]'));
  await pg.click('#dl-dialog button[value="cancel"]');

  const { file: vec } = await download(pg, 'raster-vector.pdf');
  const vdoc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(vec)), verbosity: 0 }).promise;
  check('original output keeps text', (await (await vdoc.getPage(1)).getTextContent()).items.length > 0);

  for (const dpi of [300, 600]) {
    const t0 = Date.now();
    const { file, suggested } = await download(pg, `raster-${dpi}.pdf`, dpi, 120000);
    const ms = Date.now() - t0;
    check(`${dpi} dpi file name`, suggested === `a4-landscape-合併-圖片${dpi}dpi.pdf`, suggested);
    const bytes = new Uint8Array(fs.readFileSync(file));
    const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
    check(`${dpi} dpi page count`, doc.numPages === 11, doc.numPages);
    const S = await pg.evaluate(() => window.__pdfTool.S.pages.map(p => [p.w, p.h]));
    let text = 0, okSize = true, okImg = true;
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n);
      const [w, h] = S[n - 1];
      if (p.rotate !== 0 || Math.abs(p.view[2] - w) > 0.5 || Math.abs(p.view[3] - h) > 0.5) okSize = false;
      text += (await p.getTextContent()).items.length;
      const ol = await p.getOperatorList();
      const k = ol.fnArray.indexOf(pdfjs.OPS.paintImageXObject);
      if (k < 0) { okImg = false; continue; }
      const id = ol.argsArray[k][0];
      const im = await new Promise(r => p.objs.get(id, r));
      if (Math.abs(im.width - Math.round(w / 72 * dpi)) > 2 || Math.abs(im.height - Math.round(h / 72 * dpi)) > 2) okImg = false;
    }
    check(`${dpi} dpi: page sizes = preview sizes, no rotation left`, okSize);
    check(`${dpi} dpi: one image per page at ${dpi} dpi`, okImg);
    check(`${dpi} dpi: no text left in the file`, text === 0, text);
    const lib = await (require('../vendor/pdf-lib.min.js')).PDFDocument.load(bytes);
    const P = require('../vendor/pdf-lib.min.js');
    const raw = lib.context.enumerateIndirectObjects().map(([, o]) => (o instanceof P.PDFRawStream ? o.dict.toString() : o.toString())).join('\n');
    const kinds = lib.context.enumerateIndirectObjects().map(([, o]) => (o instanceof P.PDFRawStream ? String(o.dict.get(P.PDFName.of('Subtype')) || 'content') : String(o.get && o.get(P.PDFName.of('Type'))))).sort();
    check(`${dpi} dpi: nothing but pages, images and their content`, !/SECRET_|\/Subtype \/(Link|Widget|Stamp|Form)|PieceInfo/.test(raw) && kinds.every(k => /^(\/Image|content|\/Page|\/Pages|\/Catalog|undefined)$/.test(k)), [...new Set(kinds)].join());
    const sizeKB = Math.round(bytes.length / 1024);
    console.log(`  ${dpi} dpi: 11 pages in ${ms} ms, ${sizeKB} KB`);
    // PDFKit: the white box hides B1's marker; D1's red box is where the preview had it
    const kit = pdfkitColors(file, [
      { page: 1, x: 55 / 841.89, y: 70 / 595.28 }, // inside the white box, where "B1" was
      { page: 3, x: 200 / d1.w, y: 205 / d1.h },    // inside the red box
      { page: 3, x: 200 / d1.w, y: 290 / d1.h },    // below it
    ]);
    if (kit) {
      check(`${dpi} dpi: covered text is gone from the pixels`, close(kit[0].rgb, RGB.white, 20), kit[0].rgb);
      check(`${dpi} dpi: shape burned in where previewed`, close(kit[1].rgb, RGB.red), kit[1].rgb);
      check(`${dpi} dpi: nothing red outside the shape`, !close(kit[2].rgb, RGB.red, 40), kit[2].rgb);
    }
  }
  // positive control: in the original output the covered marker is still text
  const vkit = pdfkitColors(vec, [{ page: 1, x: 47 / 841.89, y: 70 / 595.28 }]);
  if (vkit) console.log(`  (original output keeps B1 under the white box as text: ${(await (await vdoc.getPage(1)).getTextContent()).items.map(t => t.str).join('')})`);
  check('no page errors (raster)', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.close();
}

// DoD #5: 150 pages; thumbnails are lazy and scrolling stays smooth
async function bigScrollTest(browser, base) {
  for (const step of [1, 2]) await bigScroll(browser, base, step);
}
async function bigScroll(browser, base, step) {
  const pg = await newPage(browser, base, step);
  const view = step === 1 ? '#groups' : '#grid';
  const t0 = Date.now();
  await pg.setInputFiles('#file-input', [fx('big-150.pdf')]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 150, null, { timeout: 30000 });
  const loadMs = Date.now() - t0;
  await pg.waitForTimeout(1500);
  const drawnBefore = await pg.evaluate(v => [...document.querySelectorAll(v + ' canvas')].filter(c => c.style.visibility !== 'hidden').length, view);
  await pg.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    (function f(t) { window.__frames.push(t - last); last = t; if (window.__frames.length < 100000) requestAnimationFrame(f); })(last);
  });
  for (let i = 0; i < 60; i++) { await pg.mouse.wheel(0, 400); await pg.waitForTimeout(50); }
  await pg.waitForTimeout(1500);
  const stats = await pg.evaluate(() => {
    const f = window.__frames.slice(2).sort((a, b) => a - b);
    return { frames: f.length, p50: f[Math.floor(f.length * 0.5)], p95: f[Math.floor(f.length * 0.95)], max: f[f.length - 1], over50: f.filter(x => x > 50).length };
  });
  const drawnAfter = await pg.evaluate(v => [...document.querySelectorAll(v + ' canvas')].filter(c => c.style.visibility !== 'hidden').length, view);
  console.log(`  step ${step}, 150 pages: load ${loadMs} ms; thumbnails drawn before scroll ${drawnBefore}/150, after ${drawnAfter}/150; frame ms p50 ${stats.p50.toFixed(1)} p95 ${stats.p95.toFixed(1)} max ${stats.max.toFixed(1)}, ${stats.over50} frames > 50 ms of ${stats.frames}`);
  check(`step ${step}: thumbnails are lazy (not all drawn up front)`, drawnBefore < 60, drawnBefore);
  check(`step ${step}: scrolling draws more thumbnails`, drawnAfter > drawnBefore, `${drawnBefore} → ${drawnAfter}`);
  // a loose bound so a busy machine does not flake; the real numbers are logged above
  check(`step ${step}: scroll p95 frame < 100 ms`, stats.p95 < 100, stats.p95);
  fs.writeFileSync(path.join(OUT, `scroll-stats-step${step}.json`), JSON.stringify({ loadMs, drawnBefore, drawnAfter, ...stats, cpus: os.cpus().length }, null, 2));
  await pg.close();
}

main().catch(e => { console.error(e); process.exit(2); });
