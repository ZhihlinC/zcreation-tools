// Regression cases for assemble.js's sanitising, from the 2026-11-17 review
// rounds. Each case is a tiny hand-built PDF: page 1 is kept, page 2 (when
// there is one) is "deleted", and everything only page 2 owns is marked
// SECRET_. A case passes when the output holds no SECRET_ marker and page 1
// draws the same pdf.js operator list as in the source — or, for content
// that cannot be checked, when assemble refuses.
//   cd tests/pdf && node test-sanitize.js        (ASSEMBLE_JS overrides the module)
'use strict';
const zlib = require('zlib');
const PDFLib = require('../../site/pdf/vendor/pdf-lib.min.js');
const A = require(process.env.ASSEMBLE_JS || '../../site/pdf/assemble.js');

let pdfjs, failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.log('FAIL', name, detail === undefined ? '' : '— ' + detail);
}

// Raw PDF from numbered objects: a string body, or { dict, stream }.
function build(objs) {
  const nums = Object.keys(objs).map(Number).sort((a, b) => a - b);
  const parts = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let off = parts[0].length;
  const xref = {};
  for (const n of nums) {
    const o = objs[n];
    let body;
    if (typeof o === 'string') body = Buffer.from(o, 'latin1');
    else {
      const s = Buffer.isBuffer(o.stream) ? o.stream : Buffer.from(o.stream, 'latin1');
      body = Buffer.concat([Buffer.from(o.dict.replace(/>>$/, ` /Length ${s.length} >>`) + '\nstream\n', 'latin1'), s, Buffer.from('\nendstream', 'latin1')]);
    }
    const b = Buffer.concat([Buffer.from(`${n} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    xref[n] = off; parts.push(b); off += b.length;
  }
  const max = nums[nums.length - 1];
  let x = `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= max; i++) x += xref[i] != null ? String(xref[i]).padStart(10, '0') + ' 00000 n \n' : '0000000000 65535 f \n';
  x += `trailer\n<< /Size ${max + 1} /Root 1 0 R >>\nstartxref\n${off}\n%%EOF\n`;
  parts.push(Buffer.from(x, 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}
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
async function ops(bytes, n) {
  const d = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const ol = await (await d.getPage(n)).getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
  return ol.fnArray.join();
}
async function pixel(bytes, x, y) {
  const d = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const p = await d.getPage(1);
  const vp = p.getViewport({ scale: 1 });
  const { canvas, context } = d.canvasFactory.create(vp.width, vp.height);
  await p.render({ canvasContext: context, viewport: vp, canvas, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
  return [...context.getImageData(x, y, 1, 1).data.slice(0, 3)];
}

const img = tag => ({ dict: '<< /Type /XObject /Subtype /Image /Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 >>', stream: tag });
const DRAW1 = 'q 50 0 0 50 0 0 cm /Im1 Do Q';
// two pages sharing Resources 10; page 2 (deleted) draws /Im2 = SECRET_I
function twoPages({ kept = DRAW1, keptDict = '<< >>', res = '<< /XObject << /Im1 11 0 R /Im2 12 0 R >> >>', deleted = 'BT (SECRET_TEXT) Tj ET q 50 0 0 50 0 0 cm /Im2 Do Q', extra = {} } = {}) {
  return build(Object.assign({
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 200 200] >>',
    3: '<< /Type /Page /Parent 2 0 R /Resources 10 0 R /Contents 5 0 R >>',
    4: '<< /Type /Page /Parent 2 0 R /Resources 10 0 R /Contents 6 0 R >>',
    5: { dict: keptDict, stream: kept },
    6: { dict: '<< >>', stream: deleted },
    10: res,
    11: img('KEEP_IMG'),
    12: img('SECRET_I'),
  }, extra));
}
const RES = more => `<< /XObject << /Im1 11 0 R /Im2 12 0 R ${more || ''} >> >>`;
const t3 = res => ({
  20: `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1 1] /FontMatrix [1 0 0 1 0 0] /CharProcs << /a 21 0 R >> /Encoding << /Type /Encoding /Differences [97 /a] >> /FirstChar 97 /LastChar 97 /Widths [1] ${res} >>`,
  21: { dict: '<< >>', stream: '1 0 0 0 1 1 d1 q 1 0 0 1 0 0 cm /Im1 Do Q' },
});

const CASES = [
  ['shared Resources, plain content', twoPages()],
  // implicit users of the parent Resources
  ['soft-mask form with the shared Resources', twoPages({ kept: '/GS1 gs ' + DRAW1, res: '<< /XObject << /Im1 11 0 R /Im2 12 0 R >> /ExtGState << /GS1 20 0 R >> >>', extra: {
    20: '<< /Type /ExtGState /SMask << /S /Luminosity /G 21 0 R >> >>',
    21: { dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 200 200] /Group << /S /Transparency /CS /DeviceGray >> /Resources 10 0 R >>', stream: '1 g 0 0 200 200 re f' } } })],
  ['soft-mask form without Resources draws a page image', twoPages({ kept: '/GS1 gs ' + DRAW1, res: '<< /XObject << /Im1 11 0 R /Im2 12 0 R /ImM 13 0 R >> /ExtGState << /GS1 20 0 R >> >>', extra: {
    20: '<< /Type /ExtGState /SMask << /S /Luminosity /G 21 0 R >> >>',
    21: { dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 200 200] /Group << /S /Transparency /CS /DeviceGray >> >>', stream: 'q 200 0 0 200 0 0 cm /ImM Do Q' },
    13: img('KEEP_MASK') } })],
  ['tiling pattern without Resources', twoPages({ kept: '/Pattern cs /P1 scn 0 0 200 200 re f', res: '<< /XObject << /Im1 11 0 R /Im2 12 0 R >> /Pattern << /P1 20 0 R >> >>', extra: {
    20: { dict: '<< /Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 50 50] /XStep 50 /YStep 50 >>', stream: DRAW1 } } })],
  ['tiling pattern with the shared Resources', twoPages({ kept: '/Pattern cs /P1 scn 0 0 200 200 re f', res: '<< /XObject << /Im1 11 0 R /Im2 12 0 R >> /Pattern << /P1 20 0 R >> >>', extra: {
    20: { dict: '<< /Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 50 50] /XStep 50 /YStep 50 /Resources 10 0 R >>', stream: DRAW1 } } })],
  ['Type3 font without Resources', twoPages({ kept: 'BT /T3 50 Tf 10 10 Td (a) Tj ET', res: '<< /XObject << /Im1 11 0 R /Im2 12 0 R >> /Font << /T3 20 0 R >> >>', extra: t3('') })],
  ['form whose Resources ref dangles', twoPages({ kept: '/Fm1 Do', res: RES('/Fm1 20 0 R'), extra: {
    20: { dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources 99 0 R >>', stream: DRAW1 } } })],
  ['form without Resources inside a form with the shared Resources', twoPages({ kept: '/Fm1 Do', res: RES('/Fm1 20 0 R /Fm2 21 0 R'), extra: {
    20: { dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources 10 0 R >>', stream: '/Fm2 Do' },
    21: { dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 200 200] >>', stream: DRAW1 } } })],
  // lexer
  ['name containing byte A0', twoPages({ kept: 'q 50 0 0 50 0 0 cm /Im\xa0X Do Q', res: '<< /XObject << /Im#A0X 11 0 R /Im2 12 0 R >> >>' })],
  ['name containing byte 0B', twoPages({ kept: 'q 50 0 0 50 0 0 cm /Im\x0bX Do Q', res: '<< /XObject << /Im#0BX 11 0 R /Im2 12 0 R >> >>' })],
  ['name ended by NUL', twoPages({ kept: 'q 50 0 0 50 0 0 cm /Im1\x00Do Q' })],
  ['deleted page\'s name inside a string', twoPages({ kept: DRAW1 + ' BT ( /Im2 ) Tj ET' })],
  ['deleted page\'s name inside a comment', twoPages({ kept: DRAW1 + ' % /Im2' })],
  ['deleted page\'s name inside a hex string', twoPages({ kept: DRAW1 + ' BT <2F496D32> Tj ET' })],
  // allow-list below the page dict
  ['Resources key outside the categories', twoPages({ res: '<< /XObject << /Im1 11 0 R /Im2 12 0 R >> /AppPrivate 6 0 R >>' })],
  ['ProcSet carrying a reference', twoPages({ res: '<< /XObject << /Im1 11 0 R /Im2 12 0 R >> /ProcSet [/PDF 6 0 R] >>' })],
  ['page /Group with an extra key', twoPages({ extra: { 3: '<< /Type /Page /Parent 2 0 R /Resources 10 0 R /Contents 5 0 R /Group << /S /Transparency /X 6 0 R >> >>' } })],
  ['content stream dict with an extra key', twoPages({ keptDict: '<< /X 6 0 R >>' })],
  ['kept form with /PieceInfo', twoPages({ kept: '/Fm1 Do', res: RES('/Fm1 20 0 R'), extra: {
    20: { dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources << >> /PieceInfo << /Illustrator << /Private 6 0 R >> >> >>', stream: '' } } })],
  ['kept image with /Alternates', twoPages({ extra: { 11: { dict: '<< /Type /XObject /Subtype /Image /Width 8 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Alternates [<< /Image 12 0 R >>] >>', stream: 'KEEP_IMG' } } })],
];
// content that cannot be decoded cannot be checked: refuse
const D = Buffer.from(DRAW1);
const REFUSE = [
  ['content filter /Fl (abbreviation)', twoPages({ kept: zlib.deflateSync(D), keptDict: '<< /Filter /Fl >>' })],
  ['content filter /AHx (abbreviation)', twoPages({ kept: Buffer.from(D.toString('hex') + '>'), keptDict: '<< /Filter /AHx >>' })],
  ['content raw deflate without zlib header', twoPages({ kept: zlib.deflateRawSync(D), keptDict: '<< /Filter /FlateDecode >>' })],
  ['content [/Crypt] Identity', twoPages({ keptDict: '<< /Filter [/Crypt] /DecodeParms [<< /Name /Identity >>] >>' })],
];

async function main() {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const [name, bytes] of CASES) {
    let out;
    try { out = await A.assemble(PDFLib, [{ id: 'X', bytes }], [{ src: 'X', index: 0, shapes: [] }]); }
    catch (e) { check(`${name}: assembles`, false, e.message); continue; }
    const leaked = [...new Set(allText(await PDFLib.PDFDocument.load(out)).match(/SECRET_\w+/g) || [])];
    check(`${name}: nothing from the deleted page`, leaked.length === 0, leaked.join());
    check(`${name}: kept page draws the same`, (await ops(bytes, 1)) === (await ops(out, 1)));
  }
  for (const [name, bytes] of REFUSE) {
    let threw = null;
    try { await A.assemble(PDFLib, [{ id: 'X', bytes }], [{ src: 'X', index: 0, shapes: [] }]); } catch (e) { threw = e.message; }
    check(`${name}: refused`, threw && /cannot be checked/.test(threw), threw);
  }
  // positive control: the same shared-Resources file with sanitising off leaks
  const raw = await A.assemble(PDFLib, [{ id: 'X', bytes: twoPages() }], [{ src: 'X', index: 0, shapes: [] }], { sanitize: () => {} });
  check('positive control: unsanitised copy leaks SECRET_I', /SECRET_I/.test(allText(await PDFLib.PDFDocument.load(raw))));

  // default colour spaces are used without being named; they must stay
  const dg = build({ 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 200 200] >>',
    3: '<< /Type /Page /Parent 2 0 R /Resources << /ColorSpace << /DefaultGray /DeviceRGB /CS0 /DeviceGray >> >> /Contents 5 0 R >>',
    5: { dict: '<< >>', stream: '0.5 g 0 0 100 100 re f' } });
  const dgOut = await PDFLib.PDFDocument.load(await A.assemble(PDFLib, [{ id: 'X', bytes: dg }], [{ src: 'X', index: 0, shapes: [] }]));
  check('DefaultGray kept', /DefaultGray/.test(dgOut.getPage(0).node.lookup(PDFLib.PDFName.of('Resources')).toString()));

  // a layer hidden by default stays hidden (pdf.js pixel inside the layer)
  const oc = build({
    1: '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [7 0 R 8 0 R] /D << /OFF [7 0 R] /Order [7 0 R 8 0 R] >> >> >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 200 200] >>',
    3: '<< /Type /Page /Parent 2 0 R /Resources << /Properties << /oc1 7 0 R /oc2 8 0 R >> >> /Contents 5 0 R >>',
    5: { dict: '<< >>', stream: '/OC /oc1 BDC 1 0 0 rg 100 0 100 100 re f EMC /OC /oc2 BDC 0 0 1 rg 0 0 100 100 re f EMC' },
    7: '<< /Type /OCG /Name (Answer key) >>',
    8: '<< /Type /OCG /Name (Visible) >>' });
  const ocOut = await A.assemble(PDFLib, [{ id: 'X', bytes: oc }], [{ src: 'X', index: 0, shapes: [] }]);
  const hidSrc = await pixel(oc, 150, 150), hidOut = await pixel(ocOut, 150, 150);
  const visSrc = await pixel(oc, 50, 150), visOut = await pixel(ocOut, 50, 150);
  check('hidden layer hidden in source (control)', hidSrc.join() === '255,255,255', hidSrc);
  check('hidden layer stays hidden in output', hidOut.join() === hidSrc.join(), `${hidOut} vs ${hidSrc}`);
  check('visible layer stays visible in output', visOut.join() === visSrc.join() && visSrc.join() !== '255,255,255', `${visOut} vs ${visSrc}`);

  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
