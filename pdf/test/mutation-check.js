// Mutation check: break the implementation on purpose (in a temp copy; repo
// files are never touched) and confirm the tests FAIL. A mutation the tests
// do not catch is reported as SURVIVED. Each `find` must occur exactly once,
// so a mutation can never silently be a no-op.
//   node mutation-check.js            # Node-suite mutations (fast)
//   node mutation-check.js --browser  # plus browser-suite mutations (~1 min each)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PDF = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-mut-'));

const M = [
  // ---- assemble.js, Node suite
  { file: 'assemble.js', what: 'rot 0: y not flipped', find: 'case 0: return [x + dx, y + h - dy];', replace: 'case 0: return [x + dx, y + dy];' },
  { file: 'assemble.js', what: 'rot 90 formula wrong', find: 'case 90: return [x + dy, y + dx];', replace: 'case 90: return [x + dy, y + h - dx];' },
  { file: 'assemble.js', what: 'rot 180 formula wrong', find: 'case 180: return [x + w - dx, y + dy];', replace: 'case 180: return [x + dx, y + dy];' },
  { file: 'assemble.js', what: 'rot 270 formula wrong', find: 'case 270: return [x + w - dy, y + h - dx];', replace: 'case 270: return [x + dy, y + h - dx];' },
  { file: 'assemble.js', what: 'CropBox offset ignored', find: 'const { x, y, w, h } = g.box;\n    switch (g.rotate)', replace: 'const { w, h } = g.box, x = 0, y = 0;\n    switch (g.rotate)' },
  { file: 'assemble.js', what: 'ellipse radii not swapped on 90/270', find: 'xScale: r.w / 2, yScale: r.h / 2', replace: 'xScale: Math.abs(s.x2 - s.x1) / 2, yScale: Math.abs(s.y2 - s.y1) / 2' },
  { file: 'assemble.js', what: 'rounded rect: y not flipped', find: '{ x: r.x, y: r.y + r.h, color: fill', replace: '{ x: r.x, y: r.y, color: fill' },
  { file: 'assemble.js', what: 'border width ignored', find: 'const borderWidth = stroke ? s.width : 0;', replace: 'const borderWidth = stroke ? 1 : 0;' },
  { file: 'assemble.js', what: 'page order reversed', find: 'const page = out.addPage(copied.get(', replace: 'const page = out.insertPage(0, copied.get(' },
  { file: 'assemble.js', what: 'shapes drawn on the first page', find: 'for (const s of p.shapes) drawShape(PDFLib, page, s, g);', replace: 'for (const s of p.shapes) drawShape(PDFLib, out.getPage(0), s, pageGeom(out.getPage(0)));' },
  { file: 'assemble.js', what: 'duplicates copied in one call (shared Contents)', find: "const g = p.src + '#' + occ[i];", replace: "const g = p.src + '#0';" },
  { file: 'assemble.js', what: 'shared Contents array not cloned', find: 'if (v instanceof PDFLib.PDFArray) page.node.set(C, v.clone(out.context));', replace: '' },
  { file: 'assemble.js', what: 'source sanitising removed', find: '      sanitize(PDFLib, doc);\n', replace: '' },
  { file: 'assemble.js', what: 'page key allow-list removed', find: 'for (const k of node.keys()) if (!PAGE_KEYS.has(k.decodeText())) node.delete(k);', replace: '' },
  { file: 'assemble.js', what: 'Resources not pruned', find: "if (res instanceof PDFDict) node.set(N('Resources'), prune(res, namesOf(streams, where), where));", replace: '' },
  { file: 'assemble.js', what: 'drawers without own Resources not followed', find: 'for (const n of namesOf(d.streams, where)) if (!used.has(n)) { used.add(n); grew = true; }', replace: '' },
  { file: 'assemble.js', what: 'all annotations kept', find: "if (!(a instanceof PDFDict) || nameOf(a.lookup(N('Subtype'))) !== 'Link') continue;", replace: 'if (!(a instanceof PDFDict)) continue; links.push(annots.get(i)); continue;' },
  { file: 'assemble.js', what: 'fail-closed page count removed', find: 'if (n !== pages.length) throw', replace: 'if (false) throw' },
  { file: 'assemble.js', what: 'pdf.js/pdf-lib page count disagreement accepted', find: 'if (count !== doc.numPages) throw', replace: 'if (false) throw' },
  { file: 'assemble.js', what: '/Rotate 45 not treated as 0', find: '    if (r % 90 !== 0) r = 0;\n', replace: '' },
  { file: 'assemble.js', what: 'inverted MediaBox not normalised', find: 'const norm = b => [Math.min(b.x, b.x + b.width), Math.min(b.y, b.y + b.height), Math.max(b.x, b.x + b.width), Math.max(b.y, b.y + b.height)];', replace: 'const norm = b => [b.x, b.y, b.x + b.width, b.y + b.height];' },
  { file: 'assemble.js', what: 'geometry guard removed', find: 'if (p.w != null && !(', replace: 'if (false && !(' },
  { file: 'assemble.js', what: 'owner-password-only PDFs accepted', find: 'if ((await doc.getPermissions()) !== null)', replace: 'if (false)' },
  { file: 'assemble.js', what: "caller's buffer handed to pdf.js (detached)", find: '{ data: bytes.slice() }', replace: '{ data: bytes }' },
  { file: 'assemble.js', what: 'lexer does not skip strings', find: "if (c === '(') { // literal string", replace: 'if (false) { // literal string' },
  { file: 'assemble.js', what: 'lexer uses JS whitespace', find: "const WS = '\\x00\\t\\n\\f\\r '", replace: "const WS = '\\t\\n\\f\\r \\xa0\\x0b'" },
  { file: 'assemble.js', what: 'soft-mask forms not followed', find: 'if (g instanceof PDFStream) return { holder: g.dict, streams: [g] };', replace: '' },
  { file: 'assemble.js', what: 'undecodable content kept instead of refused', find: 'if (!b) throw new Error(', replace: "if (!b) return ''; if (0) throw new Error(" },
  { file: 'assemble.js', what: 'private keys on kept objects not scrubbed', find: 'if (dict) for (const k of PRIVATE_KEYS) dict.delete(N(k));', replace: '' },
  { file: 'assemble.js', what: 'Default colour spaces pruned', find: "&& !(cat === 'ColorSpace' && DEFAULT_SPACES.includes(nm))", replace: '' },
  { file: 'assemble.js', what: 'hidden layers not restored', find: '    restoreLayers(PDFLib, doc);\n', replace: '' },
  { file: 'assemble.js', what: 'content stream dict not allow-listed', find: 'for (const s of streams) keepOnly(s.dict, STREAM_KEYS);', replace: '' },
  { file: 'assemble.js', what: '縮放 about the origin, not the centre', find: '${n(cx * (1 - k))} ${n(cy * (1 - k))} cm', replace: '0 0 cm' },
  { file: 'assemble.js', what: '白邊 left out of the output', find: '        if (p.margin) whiteMargin(PDFLib, page, g, p.margin);\n', replace: '' },
  { file: 'assemble.js', what: '白邊 bands sized from the wrong side', find: 'const bx = w * pct / 100, by = h * pct / 100;', replace: 'const bx = h * pct / 100, by = w * pct / 100;' },
  { file: 'assemble.js', what: 'paper: content not centred', find: 'np.drawPage(emb, { x: (U.w - g.box.w * s) / 2, y: (U.h - g.box.h * s) / 2,', replace: 'np.drawPage(emb, { x: 0, y: 0,' },
  { file: 'assemble.js', what: 'paper: always portrait', find: 'const D = w > h ? { w: hi, h: lo } : { w: lo, h: hi };', replace: 'const D = { w: lo, h: hi };' },
  { file: 'assemble.js', what: 'paper: content stretched to fill (not uniform)', find: 'np.drawPage(emb, { x: (U.w - g.box.w * s) / 2, y: (U.h - g.box.h * s) / 2, xScale: s, yScale: s });', replace: 'np.drawPage(emb, { x: 0, y: 0, xScale: U.w / g.box.w, yScale: U.h / g.box.h });' },
  { file: 'assemble.js', what: 'paper: ISO B4 instead of JIS', find: 'B4: [257, 364]', replace: 'B4: [250, 353]' },
  // ---- app.js / editor.js, browser suite
  { file: 'app.js', suite: 'browser', what: 'window drop guard removed', find: "window.addEventListener('dragover', e => { e.preventDefault();", replace: "window.addEventListener('dragover', e => {" },
  { file: 'app.js', suite: 'browser', what: 'cmaps not configured', find: "  cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,\n", replace: '' },
  { file: 'app.js', suite: 'browser', what: 'duplicate shares shapes with original', find: "shapes: p.shapes.map(s => ({ ...s, id: 'h' + (nextId++) })) }));", replace: 'shapes: p.shapes }));' },
  { file: 'editor.js', suite: 'browser', what: 'move/resize undo snapshot taken after the drag', find: "ctx.commit(a.mode === 'move' ? '移動圖形' : '縮放圖形', before);", replace: "ctx.commit(a.mode === 'move' ? '移動圖形' : '縮放圖形');" },
  { file: 'assemble.js', what: 'user rotation ignored in the output', find: '      if (p.rot) page.setRotation(', replace: '      if (false) page.setRotation(' },
  { file: 'app.js', suite: 'browser', what: 'rotating does not turn the shapes', find: 'const n = { x1: H - s.y1, y1: s.x1, x2: H - s.y2, y2: s.x2 };', replace: 'const n = { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 };' },
  { file: 'app.js', suite: 'browser', what: 'image version ignores the rotation', find: 'const vp = page.getViewport({ scale, rotation: (page.rotate + (p.rot || 0)) % 360 });', replace: 'const vp = page.getViewport({ scale });' },
  { file: 'app.js', suite: 'browser', what: 'mixed values shown as the first page value', find: 'const lo = Math.min(...vals), hi = Math.max(...vals), mixed = lo !== hi;', replace: 'const lo = Math.min(...vals), hi = Math.max(...vals), mixed = false;' },
  { file: 'app.js', suite: 'browser', what: 'side preview not live while a slider moves', find: '  renderPreview(); // and the big preview\n', replace: '' },
  { file: 'app.js', suite: 'browser', what: 'side preview zoom ignored', find: '  const k = fit * pvZoom;', replace: '  const k = fit;' },
  { file: 'app.js', suite: 'browser', what: 'image version ignores the paper', find: '    const fit = paper && A.paperFit(paper, p.w, p.h);', replace: '    const fit = null;' },
  { file: 'app.js', suite: 'browser', what: 'moving a file does not regroup the output', find: '  S.pages = S.pages.map((p, i) => [p, i]).sort(', replace: '  if (0) S.pages = S.pages.map((p, i) => [p, i]).sort(' },
  { file: 'app.js', suite: 'browser', what: 'undo forgets the file order', find: '  S.order = u.order;\n', replace: '' },
  { file: 'app.js', suite: 'browser', what: 'step 1: shift+click ignored (single toggle)', find: 'if (e.shiftKey && psrc === src) {', replace: 'if (false && e.shiftKey && psrc === src) {' },
  { file: 'app.js', suite: 'browser', what: 'step 1: re-ticked page goes to the end, not back in file order', find: '  S.pages.splice(at, 0, ...back);', replace: '  S.pages.push(...back);' },
  { file: 'app.js', suite: 'browser', what: 'step 1: un-ticking forgets the shapes', find: '    S.parked.set(key, gone);\n', replace: '' },
  { file: 'app.js', suite: 'browser', what: 'preview / image version ignore 縮放', find: 'transform: k === 1 ? undefined : [k, 0, 0, k, W * (1 - k) / 2, H * (1 - k) / 2],', replace: 'transform: undefined,' },
  { file: 'app.js', suite: 'browser', what: 'preview / image version ignore 白邊', find: '  if (p.margin) {\n    const bx = W * p.margin / 100', replace: '  if (false) {\n    const bx = W * p.margin / 100' },
  { file: 'app.js', suite: 'browser', what: 'upload check parses on the page thread', find: ', { pageCount: workerPageCount });', replace: ');' },
  { file: 'app.js', suite: 'browser', what: 'download assembled on the page thread', find: "bytes = (await inWorker({ op: 'assemble', sources, pages, paper }, sources.map(s => s.bytes.buffer))).bytes;", replace: 'bytes = await A.assemble(window.PDFLib, sources, pages, { paper });' },
  { file: 'app.js', suite: 'browser', what: 'image version ignores the chosen dpi', find: ': 1) * dpi / 72, MAX_CANVAS_SIDE', replace: ': 1) * 1, MAX_CANVAS_SIDE' },
  { file: 'app.js', suite: 'browser', what: 'image version does not burn the shapes in', find: 'if (p.shapes.length) await burnShapes(g, p, canvas.width, canvas.height);', replace: '' },
  { file: 'app.js', suite: 'browser', what: 'download dialog does not default to the original', find: `querySelector('input[value="0"]').checked = true;`, replace: `querySelector('input[value="300"]').checked = true;` },
  { file: 'app.js', suite: 'browser', what: 'thumbnails render annotations (preview ≠ output)', find: 'canvas, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.DISABLE,', replace: 'canvas, viewport: vp,' },
];

function run(cmd, args, env) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { cwd: __dirname, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => resolve({ code, out }));
  });
}

(async () => {
  const browser = process.argv.includes('--browser');
  const todo = M.filter(m => (m.suite || 'node') === 'node' || browser);
  let survived = 0;
  const jobs = todo.map((m, i) => async () => {
    const src = fs.readFileSync(path.join(PDF, m.file), 'utf8');
    const n = src.split(m.find).length - 1;
    if (n !== 1) { console.log(`BAD   ${m.file}: "${m.what}" — find occurs ${n} times`); survived++; return; }
    const mutated = src.replace(m.find, m.replace);
    if (mutated === src) { console.log(`BAD   ${m.what} — mutation changed nothing`); survived++; return; }
    const f = path.join(TMP, i + '-' + m.file);
    fs.writeFileSync(f, mutated);
    const r = m.suite === 'browser'
      ? await run('node', ['test-browser.js'], { ['OVERRIDE_' + m.file.replace('.js', '_JS').toUpperCase()]: f })
      : await run('node', ['test-assemble.js'], { ASSEMBLE_JS: f }).then(r => (r.code ? r : run('node', ['test-sanitize.js'], { ASSEMBLE_JS: f })));
    const fails = r.out.split('\n').filter(l => l.startsWith('FAIL') || /Error/.test(l));
    if (r.code === 0) { survived++; console.log(`SURVIVED  [${m.suite || 'node'}] ${m.file}: ${m.what}`); }
    else console.log(`killed    [${m.suite || 'node'}] ${m.file}: ${m.what}  (exit ${r.code}; ${fails.length} failing lines, first: ${(fails[0] || '').slice(0, 110)})`);
  });
  // node mutations are quick; browser ones run two at a time
  const queue = [...jobs];
  await Promise.all([0, 1].map(async () => { while (queue.length) await queue.shift()(); }));
  console.log(`${todo.length - survived}/${todo.length} killed`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(survived ? 1 : 0);
})();
