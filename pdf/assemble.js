// The only code that writes the output PDF: page order, copying, and drawing
// shapes into pages. Pure functions; loads as a browser global (PdfAssemble)
// and as a Node module (tests).
//
// Coordinates: a shape is stored in "display" space — PDF points, origin at the
// top-left of the page as pdf.js shows it (CropBox, /Rotate applied). This is
// exactly the viewBox of the editor's SVG overlay, so preview and output agree.
(function (root) {
  'use strict';

  const COLORS = {
    black: [0, 0, 0],
    white: [1, 1, 1],
    red: [0.86, 0.15, 0.15],
    blue: [0.15, 0.39, 0.92],
    green: [0.09, 0.6, 0.27],
    yellow: [1, 0.82, 0],
  };
  const RRECT_RADIUS = 10; // pt; capped at half the short side

  // Geometry of a page as displayed. box = CropBox ∩ MediaBox in user space,
  // same as pdf.js's page.view. Like pdf.js, a /Rotate that is not a
  // multiple of 90 counts as 0.
  function geom(rotate, box) {
    let r = ((rotate % 360) + 360) % 360;
    if (r % 90 !== 0) r = 0;
    const turned = r === 90 || r === 270;
    return { rotate: r, box, w: turned ? box.h : box.w, h: turned ? box.w : box.h };
  }

  // Display point → PDF user space.
  function displayToPdf(dx, dy, g) {
    const { x, y, w, h } = g.box;
    switch (g.rotate) {
      case 0: return [x + dx, y + h - dy];
      case 90: return [x + dy, y + dx];
      case 180: return [x + w - dx, y + dy];
      case 270: return [x + w - dy, y + h - dx];
      default: throw new Error('unsupported rotation ' + g.rotate);
    }
  }

  // Display rect → PDF rect {x, y, w, h}. Rotations are multiples of 90°, so an
  // axis-aligned rect stays axis-aligned.
  function rectToPdf(x1, y1, x2, y2, g) {
    const a = displayToPdf(x1, y1, g), b = displayToPdf(x2, y2, g);
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
  }

  function roundedRectPath(w, h, r) {
    // SVG path (y down) with origin at the rect's top-left; pdf-lib's
    // drawSvgPath flips y around its (x, y) option.
    const k = r * 0.5523; // cubic approximation of a quarter circle
    return `M ${r} 0 H ${w - r} C ${w - r + k} 0 ${w} ${r - k} ${w} ${r} V ${h - r} ` +
      `C ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h} H ${r} C ${r - k} ${h} 0 ${h - r + k} 0 ${h - r} ` +
      `V ${r} C 0 ${r - k} ${r - k} 0 ${r} 0 Z`;
  }

  function color(PDFLib, name) {
    if (name == null) return undefined;
    const c = COLORS[name];
    if (!c) throw new Error('unknown color ' + name);
    return PDFLib.rgb(c[0], c[1], c[2]);
  }

  function drawShape(PDFLib, page, s, g) {
    const fill = color(PDFLib, s.fill);
    const stroke = color(PDFLib, s.stroke);
    const borderWidth = stroke ? s.width : 0;
    if (s.type === 'line') {
      if (!stroke) throw new Error('line needs a stroke color');
      page.drawLine({ start: pt(displayToPdf(s.x1, s.y1, g)), end: pt(displayToPdf(s.x2, s.y2, g)), thickness: s.width, color: stroke });
      return;
    }
    if (!fill && !stroke) throw new Error('shape has neither fill nor stroke');
    const r = rectToPdf(s.x1, s.y1, s.x2, s.y2, g);
    if (s.type === 'rect') {
      page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: fill, borderColor: stroke, borderWidth });
    } else if (s.type === 'ellipse') {
      page.drawEllipse({ x: r.x + r.w / 2, y: r.y + r.h / 2, xScale: r.w / 2, yScale: r.h / 2, color: fill, borderColor: stroke, borderWidth });
    } else if (s.type === 'rrect') {
      const rad = Math.min(RRECT_RADIUS, r.w / 2, r.h / 2);
      page.drawSvgPath(roundedRectPath(r.w, r.h, rad), { x: r.x, y: r.y + r.h, color: fill, borderColor: stroke, borderWidth });
    } else {
      throw new Error('unknown shape ' + s.type);
    }
  }
  function pt(a) { return { x: a[0], y: a[1] }; }

  // Display geometry of a pdf-lib page (used when drawing into the output).
  // Boxes are normalised (an inverted MediaBox is legal) and intersected,
  // falling back to the MediaBox when they do not overlap — as pdf.js does.
  function pageGeom(page) {
    const norm = b => [Math.min(b.x, b.x + b.width), Math.min(b.y, b.y + b.height), Math.max(b.x, b.x + b.width), Math.max(b.y, b.y + b.height)];
    const m = norm(page.getMediaBox()), c = norm(page.getCropBox());
    let x1 = Math.max(m[0], c[0]), y1 = Math.max(m[1], c[1]), x2 = Math.min(m[2], c[2]), y2 = Math.min(m[3], c[3]);
    if (x2 <= x1 || y2 <= y1) [x1, y1, x2, y2] = m;
    return geom(page.getRotation().angle, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  }

  // copyPages copies everything a page can reach. Anything reachable from a
  // kept page that belongs to a page the user deleted — a link target, a page
  // action, a form field's sibling on another page, an image in a Resources
  // dict several pages share, an app's private /PieceInfo — would ride along
  // into the output as invisible but extractable data. So each source is
  // sanitised before copying, by allow-list rather than by chasing leak paths:
  // - a page keeps only geometry, Resources, Contents and transparency /Group;
  // - annotations are dropped except web links, which are rebuilt from scratch
  //   (the preview renders without annotations too, so it matches the output);
  // - each page gets its own Resources holding only the names its content (and
  //   the forms / patterns / Type3 glyphs it uses) actually mention.
  // assemble() then refuses to write a file containing any page object it was
  // not asked for.
  const PAGE_KEYS = new Set(['Type', 'Parent', 'MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox', 'Rotate', 'Resources', 'Contents', 'Group', 'UserUnit']);
  const NAMED_CATEGORIES = ['XObject', 'Font', 'ExtGState', 'Pattern', 'Shading', 'ColorSpace', 'Properties'];

  function sanitizeSource(PDFLib, doc) {
    const { PDFName, PDFDict, PDFArray, PDFRawStream, PDFStream, PDFString, PDFHexString } = PDFLib;
    const N = n => PDFName.of(n);
    const ctx = doc.context;
    const nameOf = x => (x instanceof PDFName ? x.decodeText() : null);

    // Content bytes of a stream, or null when it cannot be decoded (then the
    // caller keeps that resource dict whole rather than guess).
    function bytesOf(stream) {
      try {
        if (stream instanceof PDFRawStream) return PDFLib.decodePDFRawStream(stream).decode();
        if (stream.getUnencodedContents) return stream.getUnencodedContents();
      } catch (e) { /* fall through */ }
      return null;
    }
    // Every /Name token in some content (raw and #xx-decoded spellings).
    function namesIn(streams) {
      const names = new Set();
      for (const st of streams) {
        const b = bytesOf(st);
        if (!b) return null;
        let text = '';
        for (let i = 0; i < b.length; i += 8192) text += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
        const re = /\/([^\s\/\[\]()<>{}%]+)/g;
        let m;
        while ((m = re.exec(text))) {
          names.add(m[1]);
          names.add(m[1].replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
        }
      }
      return names;
    }
    const streamsOf = contents => {
      const c = ctx.lookup(contents);
      if (c instanceof PDFArray) return c.asArray().map(r => ctx.lookup(r)).filter(x => x instanceof PDFStream);
      return c instanceof PDFStream ? [c] : [];
    };

    const done = new Set(); // streams/fonts whose own Resources were already pruned
    // Prune a Resources dict to `used` names; recurse into what it keeps.
    // Returns a new direct dict (never mutates a dict other pages may share).
    function prune(res, used) {
      if (!(res instanceof PDFDict)) return res;
      if (!used) return res; // undecodable content: keep everything
      // forms without their own Resources draw with ours, so their names count too
      const xo = res.lookup(N('XObject'));
      if (xo instanceof PDFDict) {
        let grew = true;
        while (grew) {
          grew = false;
          for (const [k, ref] of xo.entries()) {
            if (!used.has(k.decodeText())) continue;
            const f = ctx.lookup(ref);
            if (!(f instanceof PDFStream) || nameOf(f.dict.lookup(N('Subtype'))) !== 'Form' || f.dict.get(N('Resources'))) continue;
            const inner = namesIn([f]);
            if (!inner) return res;
            for (const n of inner) if (!used.has(n)) { used.add(n); grew = true; }
          }
        }
      }
      const out = ctx.obj({});
      for (const [k, v] of res.entries()) {
        const cat = k.decodeText();
        const sub = res.lookup(k);
        if (!NAMED_CATEGORIES.includes(cat) || !(sub instanceof PDFDict)) { out.set(k, v); continue; }
        const kept = ctx.obj({});
        for (const [name, ref] of sub.entries()) {
          if (!used.has(name.decodeText())) continue;
          kept.set(name, ref);
          pruneOwn(ctx.lookup(ref));
        }
        out.set(k, kept);
      }
      return out;
    }
    // Forms, tiling patterns and Type3 fonts carry their own Resources.
    function pruneOwn(obj) {
      if (done.has(obj)) return;
      done.add(obj);
      if (obj instanceof PDFStream) {
        const d = obj.dict;
        if (nameOf(d.lookup(N('Subtype'))) === 'Image') return; // never inflate scans
        const r = d.lookup(N('Resources'));
        if (r instanceof PDFDict) d.set(N('Resources'), prune(r, namesIn([obj])));
      } else if (obj instanceof PDFDict && nameOf(obj.lookup(N('Subtype'))) === 'Type3') {
        const r = obj.lookup(N('Resources'));
        const procs = obj.lookup(N('CharProcs'));
        if (r instanceof PDFDict && procs instanceof PDFDict) {
          obj.set(N('Resources'), prune(r, namesIn(procs.values().map(p => ctx.lookup(p)).filter(p => p instanceof PDFStream))));
        }
      }
    }

    for (const page of doc.getPages()) {
      const node = page.node;
      for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
        if (node.get(N(k)) === undefined) {
          const v = node.getInheritableAttribute(N(k));
          if (v !== undefined) node.set(N(k), v);
        }
      }
      const links = [];
      const annots = node.lookup(N('Annots'));
      if (annots instanceof PDFArray) {
        for (let i = 0; i < annots.size(); i++) {
          const a = annots.lookup(i);
          if (!(a instanceof PDFDict) || nameOf(a.lookup(N('Subtype'))) !== 'Link') continue;
          const act = a.lookup(N('A'));
          if (!(act instanceof PDFDict) || nameOf(act.lookup(N('S'))) !== 'URI') continue;
          const uri = act.lookup(N('URI'));
          const rect = a.lookup(N('Rect'));
          if (!(uri instanceof PDFString || uri instanceof PDFHexString) || !(rect instanceof PDFArray)) continue;
          const r = rect.asRectangle();
          links.push(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [r.x, r.y, r.x + r.width, r.y + r.height], Border: [0, 0, 0], A: { S: 'URI', URI: uri } })));
        }
      }
      for (const k of node.keys()) if (!PAGE_KEYS.has(k.decodeText())) node.delete(k);
      if (links.length) node.set(N('Annots'), ctx.obj(links));
      const res = node.lookup(N('Resources'));
      if (res instanceof PDFDict) node.set(N('Resources'), prune(res, namesIn(streamsOf(node.get(N('Contents'))))));
    }
  }

  function countPageObjects(PDFLib, doc) {
    return doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFLib.PDFDict && String(o.get(PDFLib.PDFName.of('Type'))) === '/Page').length;
  }

  // sources: [{ id, bytes }]; pages: [{ src, index, shapes }] in output order.
  // opts.sanitize exists only so the tests can prove the fail-closed check.
  async function assemble(PDFLib, sources, pages, opts = {}) {
    const sanitize = opts.sanitize || sanitizeSource;
    const out = await PDFLib.PDFDocument.create();
    const docs = new Map();
    for (const s of sources) {
      if (!pages.some(p => p.src === s.id)) continue;
      const doc = await PDFLib.PDFDocument.load(s.bytes);
      sanitize(PDFLib, doc);
      docs.set(s.id, doc);
    }
    // Pages copied in one copyPages call share resources (fonts are written
    // once). A source page used twice must be copied in a separate call, or
    // both output pages would share one Contents array and a shape drawn on
    // one would show on the other. So: group by (source, nth occurrence).
    const seen = new Map();
    const occ = pages.map(p => {
      const k = p.src + ':' + p.index;
      const n = seen.get(k) || 0;
      seen.set(k, n + 1);
      return n;
    });
    const copied = new Map();
    const groups = new Map();
    pages.forEach((p, i) => {
      const g = p.src + '#' + occ[i];
      if (!groups.has(g)) groups.set(g, { src: p.src, n: occ[i], idx: [] });
      groups.get(g).idx.push(p.index);
    });
    for (const g of groups.values()) {
      const doc = docs.get(g.src);
      if (!doc) throw new Error('missing source ' + g.src);
      const got = await out.copyPages(doc, g.idx);
      g.idx.forEach((index, j) => copied.set(g.src + ':' + index + '#' + g.n, got[j]));
    }
    pages.forEach((p, i) => {
      const page = out.addPage(copied.get(p.src + ':' + p.index + '#' + occ[i]));
      if (p.shapes && p.shapes.length) {
        const g = pageGeom(page);
        // the preview used pdf.js's geometry; drawing with a different one would
        // put a covering box in the wrong place without any error (NaN-safe)
        if (p.w != null && !(Math.abs(g.w - p.w) <= 0.5 && Math.abs(g.h - p.h) <= 0.5 && g.rotate === p.rotate)) {
          throw new Error(`page ${i + 1}: geometry mismatch (${g.w}x${g.h} rot ${g.rotate} vs ${p.w}x${p.h} rot ${p.rotate})`);
        }
        // two different source pages may share one indirect Contents array;
        // drawing appends to it, so give this page its own
        const C = PDFLib.PDFName.of('Contents');
        const contents = page.node.get(C);
        if (contents instanceof PDFLib.PDFRef) {
          const v = out.context.lookup(contents);
          if (v instanceof PDFLib.PDFArray) page.node.set(C, v.clone(out.context));
        }
        for (const s of p.shapes) drawShape(PDFLib, page, s, g);
      }
    });
    // fail closed: never write a file holding page objects nobody chose
    const n = countPageObjects(PDFLib, out);
    if (n !== pages.length) throw new Error(`output would contain ${n - pages.length} page(s) that were not chosen`);
    return out.save();
  }

  // Input gate, run at upload. Any /Encrypt (even owner-password-only files
  // that readers open without asking) is refused: pdf-lib 1.17.1 cannot read
  // them reliably (AES-256 fails with a generic parse error).
  // Returns { status: 'ok', doc, task } | { status: 'encrypted', kind: 'open'|'perms' }
  // | { status: 'notpdf' } | { status: 'broken', error }.
  // Known gap: an Encrypt dict without /P reads as 'broken', not 'encrypted'.
  async function openSource(pdfjsLib, PDFLib, bytes, params) {
    const head = String.fromCharCode.apply(null, bytes.subarray(0, 1024));
    if (head.indexOf('%PDF-') < 0) return { status: 'notpdf' };
    // pdf.js transfers the buffer to its worker; keep ours for pdf-lib
    const task = pdfjsLib.getDocument(Object.assign({}, params, { data: bytes.slice() }));
    let doc;
    try {
      doc = await task.promise;
    } catch (e) {
      task.destroy();
      if (e && e.name === 'PasswordException') return { status: 'encrypted', kind: 'open' };
      return { status: 'broken', error: e };
    }
    try {
      if ((await doc.getPermissions()) !== null) { task.destroy(); return { status: 'encrypted', kind: 'perms' }; }
      // pdf.js repairs damaged files, pdf-lib does not: if they disagree on
      // the pages, what is previewed is not what would be written
      const lib = await PDFLib.PDFDocument.load(bytes);
      if (lib.getPageCount() !== doc.numPages) throw new Error(`page count differs (pdf.js ${doc.numPages}, pdf-lib ${lib.getPageCount()})`);
    } catch (e) { task.destroy(); return { status: 'broken', error: e }; }
    return { status: 'ok', doc, task };
  }

  const api = { COLORS, RRECT_RADIUS, geom, displayToPdf, rectToPdf, pageGeom, sanitizeSource, countPageObjects, roundedRectPath, assemble, openSource };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfAssemble = api;
})(typeof self !== 'undefined' ? self : this);
