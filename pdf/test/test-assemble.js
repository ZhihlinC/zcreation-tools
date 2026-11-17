// Node tests for ../assemble.js. Oracle: pdf.js (an independent implementation
// of PDF geometry), never assemble.js's own helpers.
//   cd pdf/test && npm install && node test-assemble.js
// Env ASSEMBLE_JS overrides the module under test (used by mutation-check.js).
'use strict';
const fs = require('fs');
const path = require('path');
const PDFLib = require('../vendor/pdf-lib.min.js');
const A = require(process.env.ASSEMBLE_JS || '../assemble.js');
const { drawnPaths } = require('./oracle');

const FIX = path.join(__dirname, 'fixtures');
const read = f => new Uint8Array(fs.readFileSync(path.join(FIX, f)));
let pdfjs;
let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.log('FAIL', name, detail === undefined ? '' : '— ' + detail);
}
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
const nearArr = (a, b, eps) => a.length === b.length && a.every((v, i) => near(v, b[i], eps));
const open = data => pdfjs.getDocument({ data, verbosity: 0 }).promise;

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
  for (const f of ['a4-portrait.pdf', 'a4-landscape.pdf', 'b4.pdf', 'odd.pdf', 'geometry.pdf']) {
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
  for (const f of ['odd.pdf', 'geometry.pdf']) {
  const lib = await PDFLib.PDFDocument.load(read(f));
  const d = await open(read(f));
  for (let n = 1; n <= d.numPages; n++) {
    const p = await d.getPage(n);
    const g = A.pageGeom(lib.getPage(n - 1));
    const [x1, y1, x2, y2] = p.view;
    check(`pageGeom ${f} p${n}`, g.rotate === p.rotate && nearArr([g.box.x, g.box.y, g.box.w, g.box.h], [x1, y1, x2 - x1, y2 - y1]), JSON.stringify(g));
  }
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

// Pages whose geometry two parsers could read differently, and two pages
// sharing one Contents array (a shape on G5 must not show on G6).
const GEO_SOURCES = { G: 'geometry.pdf' };
const GEO_PLAN = [
  { src: 'G', index: 0, mark: 'G1', shapes: SHAPES },      // inherited Rotate 90 + MediaBox
  { src: 'G', index: 1, mark: 'G2', shapes: SHAPES },      // /Rotate -90
  { src: 'G', index: 2, mark: 'G3', shapes: SHAPES },      // /Rotate 45 → 0
  { src: 'G', index: 3, mark: 'G4', shapes: SHAPES },      // inverted MediaBox
  { src: 'G', index: 4, mark: 'G5', shapes: [SHAPES[0]] }, // shares Contents with the next
  { src: 'G', index: 5, mark: 'G5', shapes: [] },
];

async function testAssemble(SOURCES, PLAN, outName) {
  const sources = Object.entries(SOURCES).map(([id, f]) => ({ id, bytes: read(f) }));
  const outBytes = await A.assemble(PDFLib, sources, PLAN.map(p => ({ src: p.src, index: p.index, shapes: p.shapes })));
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', outName), outBytes);
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
    const paths = drawnPaths(pdfjs, await p.getOperatorList());
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
  for (const [f, want, kind] of [['encrypted-user.pdf', 'encrypted', 'open'], ['encrypted-owner-only.pdf', 'encrypted', 'perms'], ['a4-portrait.pdf', 'ok'], ['odd.pdf', 'ok']]) {
    const r = await A.openSource(pdfjs, PDFLib, read(f), params);
    check(`openSource ${f}`, r.status === want && r.kind === kind, `${r.status}/${r.kind}`);
    if (r.task) r.task.destroy();
  }
  const junk = new TextEncoder().encode('%PDF-1.7\nnot really a pdf');
  const r = await A.openSource(pdfjs, PDFLib, junk, params);
  check('openSource junk → broken', r.status === 'broken' && r.error, r.status);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0]);
  check('openSource non-PDF → notpdf', (await A.openSource(pdfjs, PDFLib, png, params)).status === 'notpdf');
  // the caller's bytes must survive (pdf.js transfers what it is given)
  const b = read('a4-portrait.pdf'), len = b.length;
  const ok = await A.openSource(pdfjs, PDFLib, b, params);
  check('openSource keeps caller bytes', b.length === len && b.byteLength === len, b.byteLength);
  if (ok.task) ok.task.destroy();
}

// Deleted pages must not ride along via links / annotation back-pointers.
async function testNoOrphanPages() {
  const toc = read('toc-links.pdf');
  const one = await A.assemble(PDFLib, [{ id: 'T', bytes: toc }], [{ src: 'T', index: 0, shapes: [] }, { src: 'T', index: 1, shapes: [] }]);
  const lib = await PDFLib.PDFDocument.load(one);
  const pageObjs = lib.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFLib.PDFDict && String(o.get(PDFLib.PDFName.of('Type'))) === '/Page');
  check('no orphan pages from TOC links', pageObjs.length === 2, `${pageObjs.length} page objects for 2 pages`);
  const d = await open(one.slice());
  const texts = [];
  for (let i = 1; i <= d.numPages; i++) texts.push((await (await d.getPage(i)).getTextContent()).items.map(t => t.str).join(''));
  check('TOC output keeps T1,T2', texts.join() === 'T1,T2', texts.join());
  const ann = await (await d.getPage(1)).getAnnotations();
  check('web link kept, internal links dropped', ann.length === 1 && ann[0].url === 'https://example.com/', JSON.stringify(ann.map(a => a.url || a.dest)));
  // positive control: copying the same page without stripping drags all 20 in
  const raw = await PDFLib.PDFDocument.load(toc), out = await PDFLib.PDFDocument.create();
  out.addPage((await out.copyPages(raw, [0]))[0]);
  const rawCount = out.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFLib.PDFDict && String(o.get(PDFLib.PDFName.of('Type'))) === '/Page').length;
  check('positive control: unstripped copy has orphans', rawCount > 2, rawCount);
}

async function testGeometryGuard() {
  let threw = null;
  try { await A.assemble(PDFLib, [{ id: 'A', bytes: read('a4-portrait.pdf') }], [{ src: 'A', index: 0, w: 500, h: 841.89, rotate: 0, shapes: [] }]); }
  catch (e) { threw = e.message; }
  check('geometry mismatch is refused', threw && threw.includes('geometry mismatch'), threw);
  let ok = true;
  try { await A.assemble(PDFLib, [{ id: 'A', bytes: read('a4-portrait.pdf') }], [{ src: 'A', index: 0, w: 595.28, h: 841.89, rotate: 0, shapes: [] }]); }
  catch (e) { ok = false; }
  check('matching geometry accepted', ok);
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
  await testDisplayToPdf();
  await testPageGeom();
  await testAssemble(SOURCES, PLAN, 'assembled.pdf');
  await testAssemble(GEO_SOURCES, GEO_PLAN, 'geometry-out.pdf');
  await testNoOrphanPages();
  await testGeometryGuard();
  await testOpenSource();
  await testValidation();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
