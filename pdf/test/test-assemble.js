// Node tests for ../assemble.js. Oracle: pdf.js (an independent implementation
// of PDF geometry), never assemble.js's own helpers.
//   cd pdf/test && npm install && node test-assemble.js
// Env ASSEMBLE_JS overrides the module under test (used by mutation-check.js).
'use strict';
const fs = require('fs');
const path = require('path');
const PDFLib = require('../vendor/pdf-lib.min.js');
const A = require(process.env.ASSEMBLE_JS || '../assemble.js');

const FIX = path.join(__dirname, 'fixtures');
const read = f => new Uint8Array(fs.readFileSync(path.join(FIX, f)));
let pdfjs, OPS_NAME;
let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.log('FAIL', name, detail === undefined ? '' : '— ' + detail);
}
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
const nearArr = (a, b, eps) => a.length === b.length && a.every((v, i) => near(v, b[i], eps));
const open = data => pdfjs.getDocument({ data, verbosity: 0 }).promise;

// Walk an operator list tracking the CTM; return every path drawn after the
// page's original (q…Q-wrapped) content, with its bbox in user space and the
// colors / line width in effect.
function drawnPaths(ol) {
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0], depth = 0, originalDone = false;
  let st = { fill: null, stroke: null, lw: 1 };
  const stack = [];
  const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  ol.fnArray.forEach((fn, i) => {
    const op = OPS_NAME[fn], a = ol.argsArray[i];
    if (op === 'save') { stack.push([ctm, Object.assign({}, st)]); depth++; }
    else if (op === 'restore') { [ctm, st] = stack.pop(); depth--; if (depth === 0) originalDone = true; }
    else if (op === 'transform') ctm = mul(a, ctm);
    else if (op === 'setFillRGBColor') st.fill = a[0];
    else if (op === 'setStrokeRGBColor') st.stroke = a[0];
    else if (op === 'setLineWidth') st.lw = a[0];
    else if (op === 'constructPath' && originalDone) {
      const mm = Array.from(a[2]);
      const pts = [ap(ctm, mm[0], mm[1]), ap(ctm, mm[2], mm[3]), ap(ctm, mm[0], mm[3]), ap(ctm, mm[2], mm[1])];
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const kind = pdfjs.OPS.fill === a[0] || pdfjs.OPS.eoFill === a[0] ? 'fill'
        : pdfjs.OPS.stroke === a[0] || pdfjs.OPS.closeStroke === a[0] ? 'stroke' : 'fillStroke';
      out.push({ bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], kind, fill: st.fill, stroke: st.stroke, lw: st.lw });
    }
  });
  return out;
}

const HEX = { black: '#000000', white: '#ffffff', red: '#db2626', blue: '#2663eb', green: '#179945', yellow: '#ffd100' };
const SHAPES = [
  { type: 'rect', x1: 60, y1: 80, x2: 200, y2: 130, fill: 'white', stroke: 'black', width: 2 },
  { type: 'rrect', x1: 220, y1: 40, x2: 300, y2: 160, fill: null, stroke: 'red', width: 4 },
  { type: 'ellipse', x1: 50, y1: 200, x2: 250, y2: 260, fill: 'yellow', stroke: null, width: 1 },
  { type: 'line', x1: 30, y1: 300, x2: 330, y2: 340, fill: null, stroke: 'blue', width: 8 },
];
// Expected user-space bbox of a display-space shape, computed with pdf.js.
function expectedBBox(vp, s) {
  const a = vp.convertToPdfPoint(s.x1, s.y1), b = vp.convertToPdfPoint(s.x2, s.y2);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

async function testDisplayToPdf() {
  for (const f of ['a4-portrait.pdf', 'a4-landscape.pdf', 'b4.pdf', 'odd.pdf']) {
    const d = await open(read(f));
    for (let n = 1; n <= d.numPages; n++) {
      const p = await d.getPage(n);
      const vp = p.getViewport({ scale: 1 });
      const [x1, y1, x2, y2] = p.view;
      const g = A.geom(p.rotate, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      check(`${f} p${n} display size`, near(g.w, vp.width) && near(g.h, vp.height), `${g.w}x${g.h} vs ${vp.width}x${vp.height}`);
      for (const [dx, dy] of [[0, 0], [37, 113], [g.w, g.h], [g.w * 0.25, g.h * 0.8]]) {
        const got = A.displayToPdf(dx, dy, g), want = vp.convertToPdfPoint(dx, dy);
        check(`${f} p${n} displayToPdf(${dx.toFixed(1)},${dy.toFixed(1)}) rot ${p.rotate}`, nearArr(got, want), `${got} vs ${want}`);
      }
    }
  }
}

async function testPageGeom() {
  // pageGeom reads the pdf-lib page; must agree with pdf.js on every odd page
  const lib = await PDFLib.PDFDocument.load(read('odd.pdf'));
  const d = await open(read('odd.pdf'));
  for (let n = 1; n <= d.numPages; n++) {
    const p = await d.getPage(n);
    const g = A.pageGeom(lib.getPage(n - 1));
    const [x1, y1, x2, y2] = p.view;
    check(`pageGeom odd p${n}`, g.rotate === p.rotate && nearArr([g.box.x, g.box.y, g.box.w, g.box.h], [x1, y1, x2 - x1, y2 - y1]), JSON.stringify(g));
  }
}

// The handoff's DoD #1 flow, as data: two files + odd pages, A2 deleted, A3
// duplicated, files interleaved, all four shapes on several page geometries.
const SOURCES = { A: 'a4-portrait.pdf', B: 'a4-landscape.pdf', C: 'b4.pdf', D: 'odd.pdf' };
const PLAN = [
  { src: 'B', index: 1, mark: 'B2', shapes: SHAPES },          // A4 landscape
  { src: 'A', index: 0, mark: 'A1', shapes: SHAPES },          // A4 portrait
  { src: 'D', index: 0, mark: 'D1', shapes: SHAPES },          // /Rotate 90
  { src: 'A', index: 2, mark: 'A3', shapes: [SHAPES[0]] },     // duplicated page, shape on this copy only
  { src: 'A', index: 2, mark: 'A3', shapes: [] },
  { src: 'D', index: 1, mark: 'D2', shapes: SHAPES },          // CropBox offset
  { src: 'D', index: 3, mark: 'D4', shapes: SHAPES },          // /Rotate 270 + CropBox offset
  { src: 'D', index: 2, mark: 'D3', shapes: [SHAPES[0]] },     // leftover cm in content
  { src: 'C', index: 0, mark: 'C1', shapes: SHAPES },          // B4
  { src: 'B', index: 0, mark: 'B1', shapes: [] },
  { src: 'D', index: 4, mark: 'D5', shapes: SHAPES },          // /Rotate 180
];

async function testAssemble() {
  const sources = Object.entries(SOURCES).map(([id, f]) => ({ id, bytes: read(f) }));
  const outBytes = await A.assemble(PDFLib, sources, PLAN.map(p => ({ src: p.src, index: p.index, shapes: p.shapes })));
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', 'assembled.pdf'), outBytes);
  const out = await open(outBytes.slice());
  check('page count', out.numPages === PLAN.length, out.numPages);
  const srcDocs = {};
  for (const [id, f] of Object.entries(SOURCES)) srcDocs[id] = await open(read(f));
  for (let i = 0; i < PLAN.length; i++) {
    const want = PLAN[i];
    const p = await out.getPage(i + 1);
    const text = (await p.getTextContent()).items.map(t => t.str).join('');
    check(`page ${i + 1} is ${want.mark}`, text.includes(want.mark), JSON.stringify(text));
    const sp = await srcDocs[want.src].getPage(want.index + 1);
    check(`page ${i + 1} keeps rotation`, p.rotate === sp.rotate, `${p.rotate} vs ${sp.rotate}`);
    check(`page ${i + 1} keeps view box`, nearArr(p.view, sp.view), `${p.view} vs ${sp.view}`);
    const vp = p.getViewport({ scale: 1 });
    const paths = drawnPaths(await p.getOperatorList());
    check(`page ${i + 1} (${want.mark}) shape count`, paths.length === want.shapes.length, `${paths.length} vs ${want.shapes.length}`);
    want.shapes.forEach((s, k) => {
      const got = paths[k];
      if (!got) return;
      const eb = expectedBBox(vp, s);
      // a stroked rounded rect's bbox is the rect itself; an ellipse's is too
      check(`page ${i + 1} (${want.mark}) ${s.type} position`, nearArr(got.bbox, eb, 0.05), `${got.bbox.map(v => v.toFixed(2))} vs ${eb.map(v => v.toFixed(2))}`);
      const wantKind = s.type === 'line' ? 'stroke' : s.fill && s.stroke ? 'fillStroke' : s.fill ? 'fill' : 'stroke';
      check(`page ${i + 1} (${want.mark}) ${s.type} paint`, got.kind === wantKind, `${got.kind} vs ${wantKind}`);
      if (s.fill) check(`page ${i + 1} ${s.type} fill color`, got.fill === HEX[s.fill], `${got.fill} vs ${HEX[s.fill]}`);
      if (s.stroke) {
        check(`page ${i + 1} ${s.type} stroke color`, got.stroke === HEX[s.stroke], `${got.stroke} vs ${HEX[s.stroke]}`);
        check(`page ${i + 1} ${s.type} stroke width`, near(got.lw, s.width), `${got.lw} vs ${s.width}`);
      }
    });
  }
}

async function testOpenSource() {
  const params = { verbosity: 0 };
  for (const [f, want] of [['encrypted-user.pdf', 'encrypted'], ['encrypted-owner-only.pdf', 'encrypted'], ['a4-portrait.pdf', 'ok'], ['odd.pdf', 'ok']]) {
    const r = await A.openSource(pdfjs, PDFLib, read(f), params);
    check(`openSource ${f}`, r.status === want, r.status);
    if (r.task) r.task.destroy();
  }
  const junk = new TextEncoder().encode('%PDF-1.7\nnot really a pdf');
  const r = await A.openSource(pdfjs, PDFLib, junk, params);
  check('openSource junk → broken', r.status === 'broken', r.status);
  // the caller's bytes must survive (pdf.js transfers what it is given)
  const b = read('a4-portrait.pdf'), len = b.length;
  const ok = await A.openSource(pdfjs, PDFLib, b, params);
  check('openSource keeps caller bytes', b.length === len && b.byteLength === len, b.byteLength);
  if (ok.task) ok.task.destroy();
}

async function testValidation() {
  const src = [{ id: 'A', bytes: read('a4-portrait.pdf') }];
  for (const [name, s] of [
    ['no fill no stroke', { type: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, fill: null, stroke: null, width: 1 }],
    ['line without stroke', { type: 'line', x1: 0, y1: 0, x2: 10, y2: 10, fill: 'red', stroke: null, width: 1 }],
    ['unknown color', { type: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, fill: 'pink', stroke: null, width: 1 }],
  ]) {
    let threw = false;
    try { await A.assemble(PDFLib, src, [{ src: 'A', index: 0, shapes: [s] }]); } catch (e) { threw = true; }
    check(`rejects ${name}`, threw);
  }
}

(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  OPS_NAME = Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]));
  await testDisplayToPdf();
  await testPageGeom();
  await testAssemble();
  await testOpenSource();
  await testValidation();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
