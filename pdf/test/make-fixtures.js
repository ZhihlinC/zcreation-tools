// Generates the sample PDFs in fixtures/. Run once; the output is committed.
//   npm install && node make-fixtures.js
// Every page carries a text marker (e.g. "A2") so tests can check page order.
'use strict';
const fs = require('fs');
const path = require('path');
const PDFLib = require('../vendor/pdf-lib.min.js');
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
  await encrypted('encrypted-user.pdf', { userPassword: 'open', ownerPassword: 'owner' });
  await encrypted('encrypted-owner-only.pdf', { userPassword: '', ownerPassword: 'owner', permissions: { modifying: false } });
})().catch(e => { console.error(e); process.exit(1); });
