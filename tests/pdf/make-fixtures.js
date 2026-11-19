// Generates the sample PDFs in fixtures/. Run once; the output is committed.
//   npm install && node make-fixtures.js
// Every page carries a text marker (e.g. "A2") so tests can check page order.
'use strict';
const fs = require('fs');
const path = require('path');
const PDFLib = require('../../site/pdf/vendor/pdf-lib.min.js');
const Cantoo = require('@cantoo/pdf-lib'); // only for encryption, which pdf-lib 1.17.1 cannot write
const { PDFDocument, StandardFonts, PDFName, PDFNumber, PDFArray, PDFString, PDFHexString, rgb } = PDFLib;

const OUT = path.join(__dirname, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });
const A4 = [595.28, 841.89];
const B4 = [708.66, 1000.63];

async function doc(pages) {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  for (const p of pages) {
    const page = d.addPage(p.size);
    if (p.crop) page.setCropBox(...p.crop);
    if (p.rotate) page.setRotation(PDFLib.degrees(p.rotate));
    const box = page.getCropBox();
    // light grey frame so a rendered page is visibly non-blank
    page.drawRectangle({ x: box.x + 10, y: box.y + 10, width: box.width - 20, height: box.height - 20, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 1 });
    page.drawText(p.mark, { x: box.x + 40, y: box.y + box.height - 80, size: 36, font });
    if (p.unbalancedCm) {
      // a content stream that leaves a translated CTM behind (no q/Q): later
      // drawing appended by the tool must not inherit this offset
      const raw = d.context.flateStream('1 0 0 1 150 150 cm');
      page.node.addContentStream(d.context.register(raw));
    }
  }
  return d;
}

// Non-embedded CJK font (Adobe-CNS1 + UniCNS-UCS2-H): renders only if pdf.js
// gets its cmaps. Text is 中文考卷 at (60, 400).
async function cjkDoc() {
  const d = await PDFDocument.create();
  const page = d.addPage(A4);
  const ctx = d.context;
  const cid = ctx.obj({
    Type: 'Font', Subtype: 'CIDFontType0', BaseFont: 'MingLiU',
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('CNS1'), Supplement: 0 },
    FontDescriptor: ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: 'MingLiU', Flags: 6, FontBBox: [0, -200, 1000, 900], ItalicAngle: 0, Ascent: 880, Descent: -120, CapHeight: 880, StemV: 80 })),
    DW: 1000,
  });
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'MingLiU', Encoding: 'UniCNS-UCS2-H', DescendantFonts: [ctx.register(cid)] }));
  page.node.setFontDictionary(PDFName.of('F1'), font);
  const text = Buffer.from('中文考卷', 'utf16le').swap16().toString('hex');
  page.node.addContentStream(ctx.register(ctx.flateStream(`BT /F1 60 Tf 60 400 Td <${text}> Tj ET`)));
  return d;
}

// Pages whose geometry pdf.js and pdf-lib could read differently:
// inherited /Rotate + /MediaBox, /Rotate -90, /Rotate 45, inverted MediaBox;
// plus two pages that share one indirect Contents array.
async function geometryDoc() {
  const d = await doc([
    { size: [500, 700], mark: 'G1' },          // inherits Rotate 90 + MediaBox from /Pages
    { size: A4, mark: 'G2' },                  // /Rotate -90
    { size: A4, mark: 'G3' },                  // /Rotate 45 (readers treat as 0)
    { size: A4, mark: 'G4' },                  // inverted MediaBox
    { size: A4, mark: 'G5' },                  // shares Contents with G6
    { size: A4, mark: 'G6' },
  ]);
  const ctx = d.context, N = n => PDFName.of(n);
  const pages = d.getPages();
  const tree = d.catalog.lookup(N('Pages'));
  tree.set(N('Rotate'), PDFNumber.of(90));
  tree.set(N('MediaBox'), ctx.obj([0, 0, 500, 700]));
  pages[0].node.delete(N('MediaBox'));
  for (const p of pages.slice(1)) if (!p.node.get(N('Rotate'))) p.node.set(N('Rotate'), PDFNumber.of(0));
  pages[1].node.set(N('Rotate'), PDFNumber.of(-90));
  pages[2].node.set(N('Rotate'), PDFNumber.of(45));
  pages[3].node.set(N('MediaBox'), ctx.obj([A4[0], A4[1], 0, 0]));
  const shared = ctx.register(ctx.obj([...pages[4].node.Contents().asArray ? pages[4].node.Contents().asArray() : [pages[4].node.get(N('Contents'))]]));
  pages[4].node.set(N('Contents'), shared);
  pages[5].node.set(N('Contents'), shared);
  return d;
}

// 20 pages; page 1 is a table of contents with internal links to every page
// (plus one web link), page 2 has a note whose /P points back at it.
async function tocDoc() {
  const d = await doc(Array.from({ length: 20 }, (_, i) => ({ size: A4, mark: 'T' + (i + 1) })));
  const ctx = d.context, pages = d.getPages();
  const annots = pages.map((p, i) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 700 - i * 20, 200, 715 - i * 20], Border: [0, 0, 0], Dest: [p.ref, 'Fit'] })));
  annots.push(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 200, 200, 215], A: { S: 'URI', URI: PDFString.of('https://example.com/') } })));
  pages[0].node.set(PDFName.of('Annots'), ctx.obj(annots));
  const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 700, 320, 720], Contents: PDFString.of('note'), P: pages[1].ref }));
  pages[1].node.set(PDFName.of('Annots'), ctx.obj([note]));
  return d;
}

// leaks.pdf — P1 and P3 are the pages a user keeps; every SECRET_ marker is
// reachable from them only through a path copyPages would follow:
//   P1/P2 inherit one Resources dict from /Pages; a form only P2 draws holds
//   SECRET_INHERITED. P3/P4 share one indirect Resources dict; a form only P4
//   draws holds SECRET_SHARED. P1 also has: a widget whose /Parent field lists
//   a sibling widget on P2 with value SECRET_FIELD; a link with indirect
//   /Subtype and /Dest to P2; a web link whose /Next is a GoTo P2 (and a /Dest);
//   a page /AA GoTo P2; /PieceInfo SECRET_PIECEINFO; a stamp whose appearance
//   says SECRET_STAMP. P2 and P4 draw SECRET_P2 / SECRET_P4 text.
async function leaksDoc() {
  const d = await PDFDocument.create();
  const ctx = d.context, N = n => PDFName.of(n);
  const font = await d.embedFont(StandardFonts.Helvetica);
  const pages = [1, 2, 3, 4].map(() => d.addPage(A4));
  const form = (text) => ctx.register(ctx.flateStream(`BT /F1 20 Tf 50 500 Td (${text}) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 595, 842] }));
  const fontRes = () => ctx.obj({ F1: font.ref });
  const content = (page, ops) => page.node.set(N('Contents'), ctx.register(ctx.flateStream(ops)));
  // P1/P2: inherited
  const inherited = ctx.obj({ Font: fontRes(), XObject: { FmKeep1: form('KEEP_P1_FORM'), FmSecret: form('SECRET_INHERITED') } });
  d.catalog.lookup(N('Pages')).set(N('Resources'), inherited);
  pages[0].node.delete(N('Resources')); pages[1].node.delete(N('Resources'));
  content(pages[0], 'BT /F1 30 Tf 40 760 Td (KEEP_P1) Tj ET /FmKeep1 Do');
  content(pages[1], 'BT /F1 30 Tf 40 760 Td (SECRET_P2) Tj ET /FmSecret Do');
  // P3/P4: one indirect Resources shared
  // FmKeep3 has no Resources of its own and draws FmInner from the page's:
  // pruning must follow it or P3 loses a drawing
  const inner = ctx.register(ctx.flateStream('0.2 0.4 0.8 rg 50 50 200 100 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 595, 842] }));
  const keep3 = ctx.register(ctx.flateStream('BT /F1 20 Tf 50 500 Td (KEEP_P3_FORM) Tj ET /FmInner Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 595, 842] }));
  const shared = ctx.register(ctx.obj({ Font: fontRes(), XObject: { FmKeep3: keep3, FmInner: inner, FmShared: form('SECRET_SHARED') } }));
  pages[2].node.set(N('Resources'), shared); pages[3].node.set(N('Resources'), shared);
  content(pages[2], 'BT /F1 30 Tf 40 760 Td (KEEP_P3) Tj ET /FmKeep3 Do');
  content(pages[3], 'BT /F1 30 Tf 40 760 Td (SECRET_P4) Tj ET /FmShared Do');
  // P1 annotations / page keys
  const field = ctx.register(ctx.obj({ FT: 'Tx', T: PDFString.of('name') }));
  const w1 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [40, 600, 200, 620], Parent: field, P: pages[0].ref }));
  const w2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [40, 600, 200, 620], Parent: field, P: pages[1].ref, V: PDFString.of('SECRET_FIELD') }));
  ctx.lookup(field).set(N('Kids'), ctx.obj([w1, w2]));
  pages[1].node.set(N('Annots'), ctx.obj([w2]));
  const subtypeRef = ctx.register(N('Link'));
  const linkIndirect = ctx.register(ctx.obj({ Type: 'Annot', Subtype: subtypeRef, Rect: [40, 500, 200, 520], Dest: [pages[1].ref, 'Fit'] }));
  const linkWeb = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 450, 200, 470], Dest: [pages[1].ref, 'Fit'], A: { S: 'URI', URI: PDFString.of('https://example.com/kept'), Next: { S: 'GoTo', D: [pages[1].ref, 'Fit'] } } }));
  const stampAp = ctx.register(ctx.flateStream('0 0 0 rg 0 0 100 20 re f 1 1 1 rg BT /F1 12 Tf 4 5 Td (SECRET_STAMP) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 20], Resources: { Font: { F1: font.ref } } }));
  const stamp = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [300, 700, 400, 720], AP: { N: stampAp } }));
  pages[0].node.set(N('Annots'), ctx.obj([w1, linkIndirect, linkWeb, stamp]));
  pages[0].node.set(N('AA'), ctx.obj({ O: { S: 'GoTo', D: [pages[1].ref, 'Fit'] } }));
  pages[0].node.set(N('PieceInfo'), ctx.obj({ Illustrator: { Private: ctx.register(ctx.flateStream('SECRET_PIECEINFO')) } }));
  return d;
}

// pdf.js and pdf-lib disagree on this page tree: one /Kids entry points at a
// missing object (pdf.js: 3 pages, the third unreadable; pdf-lib: 2).
async function brokenTreeDoc() {
  const d = await doc([1, 2, 3].map(i => ({ size: A4, mark: 'K' + i })));
  d.catalog.lookup(PDFName.of('Pages')).lookup(PDFName.of('Kids')).set(2, PDFLib.PDFRef.of(999));
  return d;
}

async function save(name, d) {
  fs.writeFileSync(path.join(OUT, name), await d.save({ useObjectStreams: false }));
  console.log('wrote', name);
}

async function encrypted(name, opts) {
  const d = await Cantoo.PDFDocument.create();
  const page = d.addPage(A4);
  page.drawText('E1', { x: 40, y: 760, size: 36 });
  d.encrypt(opts);
  fs.writeFileSync(path.join(OUT, name), await d.save());
  console.log('wrote', name);
}

(async () => {
  await save('a4-portrait.pdf', await doc([1, 2, 3].map(i => ({ size: A4, mark: 'A' + i }))));
  await save('a4-landscape.pdf', await doc([1, 2].map(i => ({ size: [A4[1], A4[0]], mark: 'B' + i }))));
  await save('b4.pdf', await doc([{ size: B4, mark: 'C1' }]));
  await save('odd.pdf', await doc([
    { size: A4, rotate: 90, mark: 'D1' },
    { size: [700, 900], crop: [50, 60, 500, 700], mark: 'D2' },
    { size: A4, unbalancedCm: true, mark: 'D3' },
    { size: [700, 900], crop: [40, 70, 520, 760], rotate: 270, mark: 'D4' },
    { size: A4, rotate: 180, mark: 'D5' },
  ]));
  await save('big-150.pdf', await doc(Array.from({ length: 150 }, (_, i) => ({ size: A4, mark: 'P' + (i + 1) }))));
  await save('cjk-nonembedded.pdf', await cjkDoc());
  await save('geometry.pdf', await geometryDoc());
  await save('toc-links.pdf', await tocDoc());
  await save('leaks.pdf', await leaksDoc());
  await save('broken-page-tree.pdf', await brokenTreeDoc());
  await encrypted('encrypted-user.pdf', { userPassword: 'open', ownerPassword: 'owner' });
  await encrypted('encrypted-owner-only.pdf', { userPassword: '', ownerPassword: 'owner', permissions: { modifying: false } });
})().catch(e => { console.error(e); process.exit(1); });
