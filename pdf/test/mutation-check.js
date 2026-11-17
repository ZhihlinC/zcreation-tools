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
  { file: 'assemble.js', what: 'CropBox offset ignored', find: 'const { x, y, w, h } = g.box;', replace: 'const { w, h } = g.box, x = 0, y = 0;' },
  { file: 'assemble.js', what: 'ellipse radii not swapped on 90/270', find: 'xScale: r.w / 2, yScale: r.h / 2', replace: 'xScale: Math.abs(s.x2 - s.x1) / 2, yScale: Math.abs(s.y2 - s.y1) / 2' },
  { file: 'assemble.js', what: 'rounded rect: y not flipped', find: '{ x: r.x, y: r.y + r.h, color: fill', replace: '{ x: r.x, y: r.y, color: fill' },
  { file: 'assemble.js', what: 'border width ignored', find: 'const borderWidth = stroke ? s.width : 0;', replace: 'const borderWidth = stroke ? 1 : 0;' },
  { file: 'assemble.js', what: 'page order reversed', find: 'const page = out.addPage(copied.get(', replace: 'const page = out.insertPage(0, copied.get(' },
  { file: 'assemble.js', what: 'shapes drawn on the first page', find: 'for (const s of p.shapes) drawShape(PDFLib, page, s, g);', replace: 'for (const s of p.shapes) drawShape(PDFLib, out.getPage(0), s, pageGeom(out.getPage(0)));' },
  { file: 'assemble.js', what: 'duplicates copied in one call (shared Contents)', find: "const g = p.src + '#' + occ[i];", replace: "const g = p.src + '#0';" },
  { file: 'assemble.js', what: 'shared Contents array not cloned', find: 'if (v instanceof PDFLib.PDFArray) page.node.set(C, v.clone(out.context));', replace: '' },
  { file: 'assemble.js', what: 'link/back-pointer stripping removed', find: '      stripPageRefs(PDFLib, doc);\n', replace: '' },
  { file: 'assemble.js', what: '/Rotate 45 not treated as 0', find: '    if (r % 90 !== 0) r = 0;\n', replace: '' },
  { file: 'assemble.js', what: 'inverted MediaBox not normalised', find: 'const norm = b => [Math.min(b.x, b.x + b.width), Math.min(b.y, b.y + b.height), Math.max(b.x, b.x + b.width), Math.max(b.y, b.y + b.height)];', replace: 'const norm = b => [b.x, b.y, b.x + b.width, b.y + b.height];' },
  { file: 'assemble.js', what: 'geometry guard removed', find: 'if (p.w != null && (', replace: 'if (false && (' },
  { file: 'assemble.js', what: 'owner-password-only PDFs accepted', find: 'if ((await doc.getPermissions()) !== null)', replace: 'if (false)' },
  { file: 'assemble.js', what: "caller's buffer handed to pdf.js (detached)", find: '{ data: bytes.slice() }', replace: '{ data: bytes }' },
  // ---- app.js / editor.js, browser suite
  { file: 'app.js', suite: 'browser', what: 'window drop guard removed', find: "window.addEventListener('dragover', e => { e.preventDefault();", replace: "window.addEventListener('dragover', e => {" },
  { file: 'app.js', suite: 'browser', what: 'cmaps not configured', find: "  cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,\n", replace: '' },
  { file: 'app.js', suite: 'browser', what: 'duplicate shares shapes with original', find: "shapes: p.shapes.map(s => ({ ...s, id: 'h' + (nextId++) })) }));", replace: 'shapes: p.shapes }));' },
  { file: 'editor.js', suite: 'browser', what: 'move/resize undo snapshot taken after the drag', find: "ctx.commit(a.mode === 'move' ? '移動圖形' : '縮放圖形', a.before);", replace: "ctx.commit(a.mode === 'move' ? '移動圖形' : '縮放圖形');" },
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
      : await run('node', ['test-assemble.js'], { ASSEMBLE_JS: f });
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
