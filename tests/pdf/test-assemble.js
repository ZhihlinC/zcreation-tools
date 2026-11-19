// Node tests for ../assemble.js. Oracle: pdf.js (an independent implementation
// of PDF geometry), never assemble.js's own helpers.
//   cd tests/pdf && npm install && node test-assemble.js
// Env ASSEMBLE_JS overrides the module under test (used by mutation-check.js).
'use strict';
const fs = require('fs');
const path = require('path');
const PDFLib = require('../../site/pdf/vendor/pdf-lib.min.js');
const A = require(process.env.ASSEMBLE_JS || '../../site/pdf/assemble.js');
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

// The main editing flow, as data: two files + odd pages, A2 deleted, A3
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

// The user's extra rotation (step 2 「向右轉」): output /Rotate = source +
// rot, and shapes given in the rotated display space land where pdf.js puts
// those display points on the output page.
const ROT_SOURCES = { A: 'a4-portrait.pdf', D: 'odd.pdf' };
const ROT_PLAN = [
  { src: 'A', index: 0, mark: 'A1', rot: 90, shapes: SHAPES },   // 0 → 90
  { src: 'A', index: 1, mark: 'A2', rot: 180, shapes: SHAPES },  // 0 → 180
  { src: 'D', index: 0, mark: 'D1', rot: 90, shapes: SHAPES },   // 90 → 180
  { src: 'D', index: 3, mark: 'D4', rot: 270, shapes: SHAPES },  // 270 + crop → 180
  { src: 'D', index: 4, mark: 'D5', rot: 180, shapes: [] },      // 180 → 0
];

async function testAssemble(SOURCES, PLAN, outName) {
  const sources = Object.entries(SOURCES).map(([id, f]) => ({ id, bytes: read(f) }));
  const outBytes = await A.assemble(PDFLib, sources, PLAN.map(p => ({ src: p.src, index: p.index, shapes: p.shapes, rot: p.rot })));
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
    const wantRot = (sp.rotate + (want.rot || 0)) % 360;
    check(`page ${i + 1} rotation = source + user`, p.rotate === wantRot, `${p.rotate} vs ${wantRot}`);
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
  const bt = await A.openSource(pdfjs, PDFLib, read('broken-page-tree.pdf'), params);
  check('pdf.js/pdf-lib page-count disagreement → broken', bt.status === 'broken', bt.status);
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

// Everything in the output, decoded: indirect objects, stream contents,
// strings. Used to prove no marker from an unchosen page survives.
function allText(lib) {
  const parts = [];
  for (const [, o] of lib.context.enumerateIndirectObjects()) {
    if (o instanceof PDFLib.PDFRawStream) {
      parts.push(o.dict.toString());
      try { parts.push(Buffer.from(PDFLib.decodePDFRawStream(o).decode()).toString('latin1')); } catch (e) { parts.push(Buffer.from(o.contents).toString('latin1')); }
    } else parts.push(o.toString());
  }
  return parts.join('\n');
}

// leaks.pdf: P1 and P3 are clean; everything marked SECRET_ belongs to P2/P4
// or to structures that only reach them (see make-fixtures.js).
async function testNoLeaks() {
  const bytes = read('leaks.pdf');
  const src = await PDFLib.PDFDocument.load(bytes);
  check('positive control: source holds the markers', (allText(src).match(/SECRET_\w+/g) || []).length >= 7, (allText(src).match(/SECRET_\w+/g) || []).join());
  const out = await A.assemble(PDFLib, [{ id: 'L', bytes }], [{ src: 'L', index: 0, shapes: [SHAPES[0]] }, { src: 'L', index: 2, shapes: [] }]);
  const lib = await PDFLib.PDFDocument.load(out);
  const found = allText(lib).match(/SECRET_\w+/g) || [];
  check('no SECRET_ marker from unchosen pages in the output', found.length === 0, [...new Set(found)].join());
  check('kept pages still carry their own content', /KEEP_P1/.test(allText(lib)) && /KEEP_P3/.test(allText(lib)));
  // fail closed: with sanitising switched off the copy drags in other pages,
  // and assemble must refuse rather than write them
  let refused = null;
  try { await A.assemble(PDFLib, [{ id: 'T', bytes: read('toc-links.pdf') }], [{ src: 'T', index: 0, shapes: [] }], { sanitize: () => {} }); }
  catch (e) { refused = e.message; }
  check('unchosen pages make assemble refuse', refused && /not chosen/.test(refused), refused);
  check('web link survives sanitising', /https:\/\/example\.com\/kept/.test(allText(lib)));
}

// Sanitising must not change what a page draws: for every fixture page the
// output's operator list (annotations off) equals the source's.
async function testFidelity() {
  for (const f of ['a4-portrait.pdf', 'a4-landscape.pdf', 'b4.pdf', 'odd.pdf', 'cjk-nonembedded.pdf', 'geometry.pdf', 'toc-links.pdf', 'leaks.pdf', 'big-150.pdf']) {
    const bytes = read(f);
    const sdoc = await open(bytes.slice());
    const out = await A.assemble(PDFLib, [{ id: 'S', bytes }], Array.from({ length: sdoc.numPages }, (_, i) => ({ src: 'S', index: i, shapes: [] })));
    const odoc = await open(out.slice());
    for (let n = 1; n <= sdoc.numPages; n++) {
      const a = await (await sdoc.getPage(n)).getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
      const b = await (await odoc.getPage(n)).getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
      check(`${f} p${n} draws the same after sanitising`, a.fnArray.join() === b.fnArray.join(), `${a.fnArray.length} vs ${b.fnArray.length} ops`);
    }
  }
}

// 縮放 / 白邊 (page adjustments): the page's own content is scaled about the
// centre of its visible box (text read back by pdf.js lands where the source
// text would after that scaling), white bands cover pct of the width/height
// at each edge, and shapes stay unscaled on top. Holds with a CropBox offset
// and under the user's rotation.
async function testAdjust() {
  const sources = [{ id: 'A', bytes: read('a4-portrait.pdf') }, { id: 'D', bytes: read('odd.pdf') }];
  const plan = [
    { src: 'A', index: 0, zoom: 10, shapes: [] },
    { src: 'A', index: 1, zoom: -10, margin: 5, shapes: [] },
    { src: 'A', index: 2, margin: 5, rot: 90, shapes: [SHAPES[0]] },
    { src: 'D', index: 1, zoom: 10, margin: 2, shapes: [SHAPES[2]] }, // CropBox 50,60 500x700
  ];
  const out = await A.assemble(PDFLib, sources, plan);
  const odoc = await open(out.slice());
  const srcDocs = { A: await open(read('a4-portrait.pdf')), D: await open(read('odd.pdf')) };
  for (let i = 0; i < plan.length; i++) {
    const want = plan[i];
    const sp = await srcDocs[want.src].getPage(want.index + 1), op = await odoc.getPage(i + 1);
    const [x1, y1, x2, y2] = sp.view, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, k = 1 + (want.zoom || 0) / 100;
    const st = (await sp.getTextContent()).items[0], ot = (await op.getTextContent()).items[0];
    const ex = cx + k * (st.transform[4] - cx), ey = cy + k * (st.transform[5] - cy);
    check(`adjust p${i + 1}: text scaled about the centre (zoom ${want.zoom || 0}%)`, near(ot.transform[4], ex, 0.05) && near(ot.transform[5], ey, 0.05), `${ot.transform[4].toFixed(2)},${ot.transform[5].toFixed(2)} vs ${ex.toFixed(2)},${ey.toFixed(2)}`);
    check(`adjust p${i + 1}: glyph size scaled`, near(Math.abs(ot.transform[0]), k * Math.abs(st.transform[0]), 0.05), `${ot.transform[0]} vs ${k * st.transform[0]}`);
    const paths = drawnPaths(pdfjs, await op.getOperatorList());
    const m = want.margin || 0, bw = (x2 - x1) * m / 100, bh = (y2 - y1) * m / 100;
    const bands = m ? [[x1, y1, x1 + bw, y2], [x2 - bw, y1, x2, y2], [x1, y1, x2, y1 + bh], [x1, y2 - bh, x2, y2]] : [];
    check(`adjust p${i + 1}: ${bands.length} white bands then ${want.shapes.length} shapes`, paths.length === bands.length + want.shapes.length, paths.length);
    bands.forEach((b, j) => {
      const got = paths[j];
      check(`adjust p${i + 1}: band ${j} white at the edge`, got && got.fill === '#ffffff' && got.kind === 'fill' && nearArr(got.bbox, b, 0.05), got && `${got.fill} ${got.bbox.map(v => v.toFixed(2))} vs ${b.map(v => v.toFixed(2))}`);
    });
    const vp = op.getViewport({ scale: 1 });
    want.shapes.forEach((s, j) => {
      const got = paths[bands.length + j];
      check(`adjust p${i + 1}: shape unscaled, on top`, got && nearArr(got.bbox, expectedBBox(vp, s), 0.05), got && got.bbox.join());
    });
  }
}

// The fixtures are written by pdf-lib, which always makes /Contents an array.
// Real producers (Word, browsers, scanners) write ONE stream, and some blank
// pages have no /Contents at all: 縮放 must still apply, paper must still work.
async function testContentsShapes() {
  const d = await PDFLib.PDFDocument.create();
  const pg = d.addPage([595.28, 841.89]);
  pg.drawText('S1', { x: 100, y: 700, size: 36, font: await d.embedFont(PDFLib.StandardFonts.Helvetica) });
  pg.node.set(PDFLib.PDFName.of('Contents'), pg.node.Contents().get(0)); // one stream, as most files have
  d.addPage([595.28, 841.89]); // blank: no /Contents
  const bytes = await d.save();
  check('fixture: page 1 /Contents is a single stream', (await PDFLib.PDFDocument.load(bytes)).getPage(0).node.lookup(PDFLib.PDFName.of('Contents')) instanceof PDFLib.PDFStream);
  check('fixture: page 2 has no /Contents', !(await PDFLib.PDFDocument.load(bytes)).getPage(1).node.get(PDFLib.PDFName.of('Contents')));
  const cx = 595.28 / 2, cy = 841.89 / 2;
  for (const zoom of [10, -10]) {
    const out = await A.assemble(PDFLib, [{ id: 'S', bytes }], [{ src: 'S', index: 0, zoom, shapes: [] }]);
    const t = (await (await (await open(out.slice())).getPage(1)).getTextContent()).items[0];
    const k = 1 + zoom / 100, ex = cx + k * (100 - cx), ey = cy + k * (700 - cy);
    check(`single-stream page: 縮放 ${zoom}% applied`, near(t.transform[4], ex, 0.05) && near(t.transform[5], ey, 0.05) && near(t.transform[0], 36 * k, 0.05), `${t.transform[4].toFixed(2)},${t.transform[5].toFixed(2)} size ${t.transform[0]} vs ${ex.toFixed(2)},${ey.toFixed(2)} size ${36 * k}`);
  }
  let out = null, err = null;
  try { out = await A.assemble(PDFLib, [{ id: 'S', bytes }], [{ src: 'S', index: 0, shapes: [] }, { src: 'S', index: 1, shapes: [] }], { paper: A.paperPt('A4') }); } catch (e) { err = e; }
  const odoc = out && await open(out.slice());
  check('page without /Contents: paper download works', odoc && odoc.numPages === 2, err && err.message);
  if (odoc) {
    const vp = (await odoc.getPage(2)).getViewport({ scale: 1 });
    check('page without /Contents: blank A4 sheet', near(vp.width, 210 * 72 / 25.4, 0.05) && near(vp.height, 297 * 72 / 25.4, 0.05), `${vp.width}×${vp.height}`);
  }
}

// 縮放至紙張: every output page is the chosen paper (JIS B), portrait or
// landscape like the page; its content is scaled uniformly and centred. The
// oracle is display space: a source text's on-screen position (pdf.js
// viewport) times the fit scale plus the centring offset must equal the
// output text's on-screen position — rotation and CropBox offsets included.
async function testPaper() {
  check('JIS B4 is 257×364 mm', near(A.paperPt('B4').w, 257 * 72 / 25.4) && near(A.paperPt('B4').h, 364 * 72 / 25.4));
  const files = { A: 'a4-portrait.pdf', B: 'a4-landscape.pdf', C: 'b4.pdf', D: 'odd.pdf', G: 'geometry.pdf' };
  const sources = Object.entries(files).map(([id, f]) => ({ id, bytes: read(f) }));
  const plan = [
    { src: 'B', index: 0, mark: 'B1' },            // landscape → landscape paper
    { src: 'C', index: 0, mark: 'C1' },            // ISO B4 → shrink
    { src: 'D', index: 0, mark: 'D1' },            // /Rotate 90, shown landscape
    { src: 'D', index: 1, mark: 'D2' },            // CropBox 50,60 500×700 → enlarge
    { src: 'D', index: 3, mark: 'D4' },            // /Rotate 270 + CropBox offset
    { src: 'A', index: 0, mark: 'A1', rot: 90 },   // user rotation
    { src: 'A', index: 1, mark: 'A2', zoom: -10, margin: 5 },
    { src: 'G', index: 0, mark: 'G1' },            // inherited Rotate 90
  ];
  const srcDocs = {};
  for (const [id, f] of Object.entries(files)) srcDocs[id] = await open(read(f));
  for (const name of ['A4', 'B4', 'A5']) {
    const paper = A.paperPt(name);
    const out = await A.assemble(PDFLib, sources, plan.map(p => ({ src: p.src, index: p.index, rot: p.rot, zoom: p.zoom, margin: p.margin, shapes: [] })), { paper });
    const odoc = await open(out.slice());
    check(`${name}: page count`, odoc.numPages === plan.length, odoc.numPages);
    // the expected layout comes from the unpapered output (same pages, own size)
    const plain = await open((await A.assemble(PDFLib, sources, plan.map(p => ({ src: p.src, index: p.index, rot: p.rot, zoom: p.zoom, margin: p.margin, shapes: [] })))).slice());
    for (let i = 0; i < plan.length; i++) {
      const pp = await plain.getPage(i + 1), op = await odoc.getPage(i + 1);
      const pv = pp.getViewport({ scale: 1 }), ov = op.getViewport({ scale: 1 });
      // expected layout computed here, not with A.paperFit (that is under test)
      const lo = Math.min(paper.w, paper.h), hi = Math.max(paper.w, paper.h);
      const D = pv.width > pv.height ? { w: hi, h: lo } : { w: lo, h: hi };
      const sc = Math.min(D.w / pv.width, D.h / pv.height);
      const fit = { D, s: sc, ox: (D.w - pv.width * sc) / 2, oy: (D.h - pv.height * sc) / 2 };
      check(`${name} p${i + 1} (${plan[i].mark}): paper size, page's orientation`, near(ov.width, fit.D.w, 0.05) && near(ov.height, fit.D.h, 0.05), `${ov.width.toFixed(1)}×${ov.height.toFixed(1)} vs ${fit.D.w.toFixed(1)}×${fit.D.h.toFixed(1)}`);
      const pt = (await pp.getTextContent()).items.find(t => t.str === plan[i].mark);
      const ot = (await op.getTextContent()).items.find(t => t.str === plan[i].mark);
      const [sx, sy] = pv.convertToViewportPoint(pt.transform[4], pt.transform[5]);
      const [ox, oy] = ov.convertToViewportPoint(ot.transform[4], ot.transform[5]);
      const ex = fit.ox + fit.s * sx, ey = fit.oy + fit.s * sy;
      check(`${name} p${i + 1} (${plan[i].mark}): content scaled ${fit.s.toFixed(3)} and centred`, near(ox, ex, 0.1) && near(oy, ey, 0.1), `${ox.toFixed(2)},${oy.toFixed(2)} vs ${ex.toFixed(2)},${ey.toFixed(2)}`);
    }
  }
  // nothing from unchosen pages through the paper path either
  const leak = await A.assemble(PDFLib, [{ id: 'L', bytes: read('leaks.pdf') }], [{ src: 'L', index: 0, shapes: [] }, { src: 'L', index: 2, shapes: [] }], { paper: A.paperPt('A4') });
  const found = allText(await PDFLib.PDFDocument.load(leak)).match(/SECRET_\w+/g) || [];
  check('paper output: no SECRET_ marker', found.length === 0, [...new Set(found)].join());
}

async function testGeometryGuard() {
  let threw = null;
  try { await A.assemble(PDFLib, [{ id: 'A', bytes: read('a4-portrait.pdf') }], [{ src: 'A', index: 0, w: 500, h: 841.89, rotate: 0, shapes: [SHAPES[0]] }]); }
  catch (e) { threw = e.message; }
  check('geometry mismatch is refused', threw && threw.includes('geometry mismatch'), threw);
  let ok = true;
  try { await A.assemble(PDFLib, [{ id: 'A', bytes: read('a4-portrait.pdf') }], [{ src: 'A', index: 0, w: 595.28, h: 841.89, rotate: 0, shapes: [SHAPES[0]] }]); }
  catch (e) { ok = false; }
  check('matching geometry accepted', ok);
  let reorderOnly = true;
  try { await A.assemble(PDFLib, [{ id: 'A', bytes: read('a4-portrait.pdf') }], [{ src: 'A', index: 0, w: 1, h: 1, rotate: 0, shapes: [] }]); }
  catch (e) { reorderOnly = false; }
  check('pages without shapes are not blocked by geometry', reorderOnly);
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
  await testAssemble(ROT_SOURCES, ROT_PLAN, 'rotated-out.pdf');
  await testNoOrphanPages();
  await testNoLeaks();
  await testFidelity();
  await testAdjust();
  await testContentsShapes();
  await testPaper();
  await testGeometryGuard();
  await testOpenSource();
  await testValidation();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
