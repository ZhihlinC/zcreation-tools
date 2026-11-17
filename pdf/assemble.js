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

  const PAGE_KEYS = new Set(['Type', 'Parent', 'MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox', 'Rotate', 'Resources', 'Contents', 'Group', 'UserUnit']);
  const NAMED_CATEGORIES = ['XObject', 'Font', 'ExtGState', 'Pattern', 'Shading', 'ColorSpace', 'Properties'];
  const DEFAULT_SPACES = ['DefaultRGB', 'DefaultGray', 'DefaultCMYK']; // used implicitly, never named in content
  const GROUP_KEYS = ['Type', 'S', 'CS', 'I', 'K'];
  const STREAM_KEYS = ['Length', 'Filter', 'DecodeParms'];
  // app-private or cross-object keys that kept forms / images / fonts may carry
  const PRIVATE_KEYS = ['PieceInfo', 'LastModified', 'Metadata', 'Alternates', 'OPI', 'Thumb', 'StructParent', 'StructParents'];

  // Every name token in PDF content, per the PDF lexer: strings, hex strings,
  // comments and inline image data are skipped, whitespace is PDF's
  // (NUL TAB LF FF CR SP), and #xx escapes are decoded.
  const WS = '\x00\t\n\f\r ', DELIM = '()<>[]{}/%';
  function contentNames(text) {
    const names = new Set();
    const n = text.length;
    let i = 0;
    const isWs = c => WS.indexOf(c) >= 0;
    while (i < n) {
      const c = text[i];
      if (c === '%') { while (i < n && text[i] !== '\n' && text[i] !== '\r') i++; continue; }
      if (c === '(') { // literal string, balanced parens, backslash escapes
        let depth = 0;
        for (; i < n; i++) {
          if (text[i] === '\\') { i++; continue; }
          if (text[i] === '(') depth++;
          else if (text[i] === ')' && --depth === 0) { i++; break; }
        }
        continue;
      }
      if (c === '<' && text[i + 1] !== '<') { const e = text.indexOf('>', i); i = e < 0 ? n : e + 1; continue; }
      if (c === '/') {
        let j = i + 1;
        while (j < n && !isWs(text[j]) && DELIM.indexOf(text[j]) < 0) j++;
        names.add(text.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
        i = j;
        continue;
      }
      if (c === 'I' && text[i + 1] === 'D' && (i === 0 || isWs(text[i - 1])) && isWs(text[i + 2] || ' ')) {
        // inline image data: skip to a whitespace-delimited EI
        let j = i + 3;
        while (j < n && !(text[j] === 'E' && text[j + 1] === 'I' && isWs(text[j - 1]) && (j + 2 >= n || isWs(text[j + 2]))) ) j++;
        i = j + 2;
        continue;
      }
      i++;
    }
    return names;
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
  // - each Resources dict (page, form, pattern, Type3 font, soft mask) is
  //   rebuilt holding only the names its own content mentions — plus the names
  //   of anything it draws that has no Resources of its own;
  // - content that cannot be decoded (so cannot be checked) refuses the file.
  // assemble() then refuses to write a file containing any page object it was
  // not asked for.
  function sanitizeSource(PDFLib, doc) {
    const { PDFName, PDFDict, PDFArray, PDFRawStream, PDFStream, PDFString, PDFHexString } = PDFLib;
    const N = n => PDFName.of(n);
    const ctx = doc.context;
    const nameOf = x => (x instanceof PDFName ? x.decodeText() : null);
    const keepOnly = (dict, keys) => { for (const k of dict.keys()) if (!keys.includes(k.decodeText())) dict.delete(k); };

    function textOf(stream, where) {
      let b;
      try {
        b = stream instanceof PDFRawStream ? PDFLib.decodePDFRawStream(stream).decode() : stream.getUnencodedContents();
      } catch (e) { b = null; }
      if (!b) throw new Error(`${where}: content cannot be checked (unsupported or damaged stream)`);
      let t = '';
      for (let i = 0; i < b.length; i += 8192) t += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
      return t;
    }
    const namesOf = (streams, where) => {
      const all = new Set();
      for (const s of streams) for (const n of contentNames(textOf(s, where))) all.add(n);
      return all;
    };

    // Things a Resources dict names that draw with resources: their content
    // streams and their own Resources (undefined → they use the parent's).
    function drawer(cat, obj) {
      if ((cat === 'XObject' || cat === 'Pattern') && obj instanceof PDFStream) {
        const sub = nameOf(obj.dict.lookup(N('Subtype')));
        if (cat === 'XObject' && sub !== 'Form') return null; // images: never inflate
        return { holder: obj.dict, streams: [obj] };
      }
      if (cat === 'Font' && obj instanceof PDFDict && nameOf(obj.lookup(N('Subtype'))) === 'Type3') {
        const procs = obj.lookup(N('CharProcs'));
        const streams = procs instanceof PDFDict ? procs.values().map(p => ctx.lookup(p)).filter(p => p instanceof PDFStream) : [];
        return { holder: obj, streams };
      }
      if (cat === 'ExtGState' && obj instanceof PDFDict) {
        const sm = obj.lookup(N('SMask'));
        const g = sm instanceof PDFDict ? sm.lookup(N('G')) : null;
        if (g instanceof PDFStream) return { holder: g.dict, streams: [g] };
      }
      return null;
    }

    const pruned = new Map(); // holder dict → done
    // Rebuild `res` for content naming `used`; returns a new direct dict.
    function prune(res, used, where) {
      if (!(res instanceof PDFDict)) return res;
      // fixpoint: drawers without their own Resources draw with this one
      let grew = true;
      while (grew) {
        grew = false;
        for (const cat of ['XObject', 'Pattern', 'Font', 'ExtGState']) {
          const sub = res.lookup(N(cat));
          if (!(sub instanceof PDFDict)) continue;
          for (const [k, ref] of sub.entries()) {
            if (!used.has(k.decodeText())) continue;
            const d = drawer(cat, ctx.lookup(ref));
            if (!d || d.holder.lookup(N('Resources')) instanceof PDFDict) continue;
            for (const n of namesOf(d.streams, where)) if (!used.has(n)) { used.add(n); grew = true; }
          }
        }
      }
      const out = ctx.obj({});
      for (const cat of NAMED_CATEGORIES) {
        const sub = res.lookup(N(cat));
        if (!(sub instanceof PDFDict)) continue;
        const kept = ctx.obj({});
        for (const [name, ref] of sub.entries()) {
          const nm = name.decodeText();
          if (!used.has(nm) && !(cat === 'ColorSpace' && DEFAULT_SPACES.includes(nm))) continue;
          kept.set(name, ref);
          const obj = ctx.lookup(ref);
          scrub(obj);
          const d = drawer(cat, obj);
          if (d) pruneOwn(d, where);
        }
        out.set(N(cat), kept);
      }
      const procSet = res.lookup(N('ProcSet'));
      if (procSet instanceof PDFArray) out.set(N('ProcSet'), ctx.obj(procSet.asArray().filter(x => x instanceof PDFName)));
      return out;
    }
    function pruneOwn(d, where) {
      if (pruned.has(d.holder)) return;
      pruned.set(d.holder, true);
      const r = d.holder.lookup(N('Resources'));
      if (r instanceof PDFDict) d.holder.set(N('Resources'), prune(r, namesOf(d.streams, where), where));
    }
    function scrub(obj) {
      const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
      if (dict) for (const k of PRIVATE_KEYS) dict.delete(N(k));
    }

    doc.getPages().forEach((page, pi) => {
      const where = `page ${pi + 1}`;
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
      const group = node.lookup(N('Group'));
      if (group instanceof PDFDict) { const g = ctx.obj({}); for (const k of GROUP_KEYS) if (group.get(N(k)) !== undefined) g.set(N(k), group.get(N(k))); node.set(N('Group'), g); }
      const c = node.lookup(N('Contents'));
      const streams = c instanceof PDFArray ? c.asArray().map(r => ctx.lookup(r)).filter(x => x instanceof PDFStream) : c instanceof PDFStream ? [c] : [];
      for (const s of streams) keepOnly(s.dict, STREAM_KEYS);
      const res = node.lookup(N('Resources'));
      if (res instanceof PDFDict) node.set(N('Resources'), prune(res, namesOf(streams, where), where));
    });
  }

  // Layers (optional content) hidden by default in a source stay hidden in
  // the output: the preview uses the source's default visibility, and an
  // output without /OCProperties would show every layer. OCGs are tagged in
  // the source before copying and collected from the output afterwards.
  const OFF_TAG = 'ZcPdfToolOff';
  function tagHiddenLayers(PDFLib, doc) {
    const { PDFName, PDFDict, PDFArray } = PDFLib;
    const N = n => PDFName.of(n);
    const ocp = doc.catalog.lookup(N('OCProperties'));
    if (!(ocp instanceof PDFDict)) return;
    const all = ocp.lookup(N('OCGs')), d = ocp.lookup(N('D'));
    if (!(all instanceof PDFArray) || !(d instanceof PDFDict)) return;
    const ids = arr => (arr instanceof PDFArray ? arr.asArray().map(String) : []);
    const on = new Set(ids(d.lookup(N('ON')))), off = new Set(ids(d.lookup(N('OFF'))));
    const baseOff = String(d.get(N('BaseState'))) === '/OFF';
    for (const ref of all.asArray()) {
      const g = doc.context.lookup(ref);
      const hidden = off.has(String(ref)) || (baseOff && !on.has(String(ref)));
      if (g instanceof PDFDict && hidden) g.set(N(OFF_TAG), PDFLib.PDFBool.True);
    }
  }
  function restoreLayers(PDFLib, out) {
    const { PDFName, PDFDict } = PDFLib;
    const N = n => PDFName.of(n);
    const ocgs = [], off = [];
    for (const [ref, o] of out.context.enumerateIndirectObjects()) {
      if (!(o instanceof PDFDict) || String(o.get(N('Type'))) !== '/OCG') continue;
      ocgs.push(ref);
      if (o.get(N(OFF_TAG))) { off.push(ref); o.delete(N(OFF_TAG)); }
    }
    if (ocgs.length) out.catalog.set(N('OCProperties'), out.context.obj({ OCGs: ocgs, D: { OFF: off } }));
  }

  function countPageObjects(PDFLib, doc) {
    return doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFLib.PDFDict && String(o.get(PDFLib.PDFName.of('Type'))) === '/Page').length;
  }

  // 縮放: the page's own content scaled by (1 + pct/100) about the centre of
  // its visible box, page size unchanged (a negative pct shrinks it). The
  // content stays vector; what is pushed past the edge is simply cut.
  function zoomContent(PDFLib, out, page, g, pct) {
    const k = 1 + pct / 100;
    const cx = g.box.x + g.box.w / 2, cy = g.box.y + g.box.h / 2;
    const n = v => Number(v.toFixed(6));
    const start = out.context.register(out.context.flateStream(`q ${n(k)} 0 0 ${n(k)} ${n(cx * (1 - k))} ${n(cy * (1 - k))} cm`));
    const end = out.context.register(out.context.flateStream('Q'));
    page.node.wrapContentStreams(start, end);
  }
  // 白邊: white bands over the outer edge, pct of the page's width on the
  // left and right and of its height at top and bottom (so the same on
  // screen whatever the rotation). Drawn over the content, under the shapes.
  function whiteMargin(PDFLib, page, g, pct) {
    const { x, y, w, h } = g.box;
    const bx = w * pct / 100, by = h * pct / 100;
    const white = PDFLib.rgb(1, 1, 1);
    for (const [rx, ry, rw, rh] of [[x, y, bx, h], [x + w - bx, y, bx, h], [x, y, w, by], [x, y + h - by, w, by]]) {
      page.drawRectangle({ x: rx, y: ry, width: rw, height: rh, color: white, borderWidth: 0 });
    }
  }

  // sources: [{ id, bytes }]; pages: [{ src, index, shapes, rot?, zoom?, margin? }]
  // in output order. rot = extra clockwise rotation the user asked for
  // (0/90/180/270); zoom / margin in percent; shapes are in the display space
  // of the rotated, adjusted page.
  // opts.sanitize exists only so the tests can prove the fail-closed check.
  async function assemble(PDFLib, sources, pages, opts = {}) {
    const sanitize = opts.sanitize || sanitizeSource;
    const out = await PDFLib.PDFDocument.create();
    const docs = new Map();
    for (const s of sources) {
      if (!pages.some(p => p.src === s.id)) continue;
      const doc = await PDFLib.PDFDocument.load(s.bytes);
      tagHiddenLayers(PDFLib, doc);
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
      if (p.rot) page.setRotation(PDFLib.degrees((pageGeom(page).rotate + p.rot) % 360));
      const hasShapes = p.shapes && p.shapes.length;
      if (hasShapes || p.zoom || p.margin) {
        const g = pageGeom(page);
        // the preview used pdf.js's geometry; drawing with a different one would
        // put a covering box in the wrong place without any error (NaN-safe)
        if (p.w != null && !(Math.abs(g.w - p.w) <= 0.5 && Math.abs(g.h - p.h) <= 0.5 && g.rotate === p.rotate)) {
          throw new Error(`page ${i + 1}: geometry mismatch (${g.w}x${g.h} rot ${g.rotate} vs ${p.w}x${p.h} rot ${p.rotate})`);
        }
        // two different source pages may share one indirect Contents array;
        // drawing (and the zoom wrap) changes it, so give this page its own
        const C = PDFLib.PDFName.of('Contents');
        const contents = page.node.get(C);
        if (contents instanceof PDFLib.PDFRef) {
          const v = out.context.lookup(contents);
          if (v instanceof PDFLib.PDFArray) page.node.set(C, v.clone(out.context));
        }
        if (p.zoom) zoomContent(PDFLib, out, page, g, p.zoom);
        if (p.margin) whiteMargin(PDFLib, page, g, p.margin);
        if (hasShapes) for (const s of p.shapes) drawShape(PDFLib, page, s, g);
      }
    });
    const doc = opts.paper ? await fitToPaper(PDFLib, out, opts.paper) : out;
    restoreLayers(PDFLib, doc);
    // fail closed: never write a file holding page objects nobody chose
    const n = countPageObjects(PDFLib, doc);
    if (n !== pages.length) throw new Error(`output would contain ${n - pages.length} page(s) that were not chosen`);
    return doc.save();
  }

  // Paper sizes in mm (portrait). B sizes are JIS — the ones Taiwanese and
  // Japanese copiers and exam papers use (ISO B4 would be 250 × 353).
  const PAPERS = { A5: [148, 210], B5: [182, 257], A4: [210, 297], B4: [257, 364], A3: [297, 420] };
  const paperPt = name => PAPERS[name] && { w: PAPERS[name][0] * 72 / 25.4, h: PAPERS[name][1] * 72 / 25.4 };
  // The paper as the page is seen: portrait or landscape like the page (a
  // square page counts as portrait), and the uniform scale that fits it.
  function paperFit(paper, w, h) {
    const lo = Math.min(paper.w, paper.h), hi = Math.max(paper.w, paper.h);
    const D = w > h ? { w: hi, h: lo } : { w: lo, h: hi };
    const s = Math.min(D.w / w, D.h / h);
    return { D, s, ox: (D.w - w * s) / 2, oy: (D.h - h * s) / 2 };
  }
  // 縮放至紙張: each page (as shown — rotation, adjustments, shapes already
  // in it) is embedded whole and drawn scaled to fit and centred on a new
  // page of that paper size; the new page keeps the rotation, so the
  // content stays vector and nothing else of the old page comes along.
  async function fitToPaper(PDFLib, out, paper) {
    const fin = await PDFLib.PDFDocument.create();
    for (const page of out.getPages()) {
      const g = pageGeom(page);
      const { D, s } = paperFit(paper, g.w, g.h);
      const turned = g.rotate === 90 || g.rotate === 270;
      const U = turned ? { w: D.h, h: D.w } : D; // the paper before /Rotate
      const emb = await fin.embedPage(page, { left: g.box.x, bottom: g.box.y, right: g.box.x + g.box.w, top: g.box.y + g.box.h });
      const np = fin.addPage([U.w, U.h]);
      if (g.rotate) np.setRotation(PDFLib.degrees(g.rotate));
      np.drawPage(emb, { x: (U.w - g.box.w * s) / 2, y: (U.h - g.box.h * s) / 2, xScale: s, yScale: s });
    }
    return fin;
  }

  // Input gate, run at upload. Any /Encrypt (even owner-password-only files
  // that readers open without asking) is refused: pdf-lib 1.17.1 cannot read
  // them reliably (AES-256 fails with a generic parse error).
  // Returns { status: 'ok', doc, task } | { status: 'encrypted', kind: 'open'|'perms' }
  // | { status: 'notpdf' } | { status: 'broken', error }.
  // Known gap: an Encrypt dict without /P reads as 'broken', not 'encrypted'.
  // opts.pageCount(bytes) → Promise<number> lets the browser run the pdf-lib
  // parse in a worker (it blocks for seconds on big files); default: inline.
  async function openSource(pdfjsLib, PDFLib, bytes, params, opts = {}) {
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
      const count = opts.pageCount ? await opts.pageCount(bytes) : (await PDFLib.PDFDocument.load(bytes)).getPageCount();
      if (count !== doc.numPages) throw new Error(`page count differs (pdf.js ${doc.numPages}, pdf-lib ${count})`);
    } catch (e) { task.destroy(); return { status: 'broken', error: e }; }
    return { status: 'ok', doc, task };
  }

  const api = { PAPERS, paperPt, paperFit, COLORS, RRECT_RADIUS, geom, displayToPdf, rectToPdf, pageGeom, sanitizeSource, contentNames, countPageObjects, roundedRectPath, assemble, openSource };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfAssemble = api;
})(typeof self !== 'undefined' ? self : this);
