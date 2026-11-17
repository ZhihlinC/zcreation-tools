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
async function download(pg, name) {
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#download-btn')]);
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
    await flowTest(browser, base, pdfjs);
    await rotatedTest(browser, base, pdfjs);
    await errorsTest(browser, base);
    await dropGuardTest(browser, base);
    await cjkTest(browser, base);
    await loadFailureTest(browser, base);
    await bigScrollTest(browser, base);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

async function newPage(browser, base) {
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  pg.errors = [];
  pg.on('pageerror', e => pg.errors.push(e.message));
  pg.on('console', m => { if (/Content Security Policy|Refused to/.test(m.text())) pg.errors.push(m.text()); });
  await pg.goto(base);
  await pg.waitForFunction(() => window.__pdfTool && window.__pdfTool.editorAvailable);
  return pg;
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
  check('empty state after deleting all', await pg.isVisible('#empty'));
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
}

// DoD #5: 150 pages; thumbnails are lazy and scrolling stays smooth
async function bigScrollTest(browser, base) {
  const pg = await newPage(browser, base);
  const t0 = Date.now();
  await pg.setInputFiles('#file-input', [fx('big-150.pdf')]);
  await pg.waitForFunction(() => window.__pdfTool.S.pages.length === 150, null, { timeout: 30000 });
  const loadMs = Date.now() - t0;
  await pg.waitForTimeout(1500);
  const drawnBefore = await pg.evaluate(() => [...document.querySelectorAll('#grid canvas')].filter(c => c.style.visibility !== 'hidden').length);
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
  const drawnAfter = await pg.evaluate(() => [...document.querySelectorAll('#grid canvas')].filter(c => c.style.visibility !== 'hidden').length);
  console.log(`  150 pages: load ${loadMs} ms; thumbnails drawn before scroll ${drawnBefore}/150, after ${drawnAfter}/150; frame ms p50 ${stats.p50.toFixed(1)} p95 ${stats.p95.toFixed(1)} max ${stats.max.toFixed(1)}, ${stats.over50} frames > 50 ms of ${stats.frames}`);
  check('thumbnails are lazy (not all drawn up front)', drawnBefore < 60, drawnBefore);
  check('scrolling draws more thumbnails', drawnAfter > drawnBefore, `${drawnBefore} → ${drawnAfter}`);
  check('scroll p95 frame < 50 ms', stats.p95 < 50, stats.p95);
  fs.writeFileSync(path.join(OUT, 'scroll-stats.json'), JSON.stringify({ loadMs, drawnBefore, drawnAfter, ...stats, cpus: os.cpus().length }, null, 2));
  await pg.close();
}

main().catch(e => { console.error(e); process.exit(2); });
