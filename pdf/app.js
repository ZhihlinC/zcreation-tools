// PDF 頁面整理: page grid, selection, drag-reorder, undo, download.
// Everything runs in this tab; files never leave the browser.
import * as pdfjsLib from './vendor/pdf.min.js';

const A = window.PdfAssemble;

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.js', import.meta.url).href;
const PDFJS_PARAMS = {
  cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
  wasmUrl: new URL('./vendor/wasm/', import.meta.url).href,
  isEvalSupported: false,
  verbosity: 0,
};
// One shared worker; if its script cannot load (404, wrong MIME) say so
// instead of reporting every file as unreadable.
PDFJS_PARAMS.worker = new pdfjsLib.PDFWorker();
PDFJS_PARAMS.worker.promise.catch(e => { console.error(e); document.getElementById('load-failed').hidden = false; });

// pdf-lib parses on the main thread and freezes the page for seconds on big
// files, so the upload check and the download assembly run in a worker.
const libWorker = new Worker(new URL('./pdf-worker.js', import.meta.url));
let workerSeq = 0;
const workerWaiting = new Map();
libWorker.onmessage = e => {
  const w = workerWaiting.get(e.data.id);
  if (!w) return;
  workerWaiting.delete(e.data.id);
  if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data);
};
libWorker.onerror = e => {
  console.error(e);
  for (const w of workerWaiting.values()) w.reject(new Error('worker failed'));
  workerWaiting.clear();
  document.getElementById('load-failed').hidden = false;
};
function inWorker(msg, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++workerSeq;
    workerWaiting.set(id, { resolve, reject });
    libWorker.postMessage(Object.assign({ id }, msg), transfer);
  });
}
const workerPageCount = bytes => { const copy = bytes.slice(); return inWorker({ op: 'count', bytes: copy }, [copy.buffer]).then(r => r.count); };
const THUMB_BOX = { w: 140, h: 182 }; // css px a page is fitted into
const DRAG_THRESHOLD = 5;
const UNDO_LIMIT = 100;

const $ = id => document.getElementById(id);
const S = {
  sources: new Map(),   // id -> { id, name, bytes, doc }
  pages: [],            // { uid, src, index, w, h, rotate, shapes: [] }
  sel: new Set(),       // uids
  anchor: null,
  undo: [],             // { label, pages }
  dirty: false,
  busy: false,
  rev: 0,               // bumps on every change; download clears dirty only if unchanged
  step: 1,              // 1 = pick pages per file, 2 = order & shapes
  parked: new Map(),    // "src:index" -> entries un-ticked in step 1 (kept so re-ticking restores their shapes)
  collapsed: new Set(), // source ids whose group is folded in step 1
  focus: null,          // "src:index" shown in the step-1 preview
  pvOpen: true,
};
let nextId = 1;
const uid = () => 'p' + (nextId++);

// ---------- undo ----------
const clonePages = pages => pages.map(p => ({ ...p, shapes: p.shapes.map(s => ({ ...s })) }));
function snapshot() { return clonePages(S.pages); }
// Record a change. `before` is the snapshot taken before the change (callers
// that mutate over several events, like a drag, take it at the start).
function commit(label, before = null) {
  S.undo.push({ label, pages: before || snapshot() });
  if (S.undo.length > UNDO_LIMIT) S.undo.shift();
  S.dirty = true;
  S.rev++;
}
function undo() {
  if (press || ctx.editorGesture()) return; // mid-drag: the gesture commits on release
  const u = S.undo.pop();
  if (!u) return;
  S.pages = u.pages;
  S.rev++;
  const alive = new Set(S.pages.map(p => p.uid));
  for (const id of [...S.sel]) if (!alive.has(id)) S.sel.delete(id);
  S.dirty = true;
  render();
  toast('已復原：' + u.label);
  ctx.onUndo();
}

// ---------- toast & errors ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function showErrors(list) {
  if (!list.length) return;
  const ul = $('errors').querySelector('ul');
  for (const m of list) { const li = document.createElement('li'); li.textContent = m; ul.appendChild(li); }
  $('errors').hidden = false;
}
$('errors-close').onclick = () => { $('errors').hidden = true; $('errors').querySelector('ul').textContent = ''; };

// ---------- adding files ----------
async function addFiles(files) {
  const errs = [];
  const added = [];
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { errs.push(`${f.name}：不是 PDF 檔`); continue; }
    const loading = loadingCard(f.name);
    try {
      loading.stage('讀取檔案…');
      const bytes = new Uint8Array(await f.arrayBuffer());
      loading.stage('檢查檔案…');
      const r = await A.openSource(pdfjsLib, window.PDFLib, bytes, PDFJS_PARAMS, { pageCount: workerPageCount });
      if (r.status === 'encrypted') {
        errs.push(`${f.name}：不支援有密碼保護的 PDF（${r.kind === 'open' ? '需要開啟密碼' : '這個檔案設了權限密碼'}）`);
        continue;
      }
      if (r.status === 'notpdf') { errs.push(`${f.name}：不是 PDF 檔`); continue; }
      if (r.status !== 'ok') {
        console.error(f.name, r.error);
        errs.push(`${f.name}：無法讀取這個檔案（可以把檔案寄給 Yves 看看）`);
        continue;
      }
      const id = 's' + (nextId++);
      const fresh = [];
      for (let i = 0; i < r.doc.numPages; i++) {
        if (i % 10 === 0) loading.stage(`準備頁面 ${i}/${r.doc.numPages}`, i, r.doc.numPages);
        const pg = await r.doc.getPage(i + 1);
        const [x1, y1, x2, y2] = pg.view;
        const g = A.geom(pg.rotate, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
        fresh.push({ uid: uid(), src: id, index: i, w: g.w, h: g.h, rotate: g.rotate, shapes: [] });
      }
      // one synchronous step per file, so edits made while it loaded and the
      // undo stack stay consistent
      S.sources.set(id, { id, name: f.name, bytes, doc: r.doc, geoms: fresh.map(p => ({ w: p.w, h: p.h, rotate: p.rotate })) });
      if (!S.focus) S.focus = id + ':0';
      commit('加入 ' + f.name);
      S.pages.push(...fresh);
      added.push(...fresh.map(p => p.uid));
      render();
    } catch (e) {
      console.error(f.name, e);
      errs.push(`${f.name}：無法讀取這個檔案（可以把檔案寄給 Yves 看看）`);
    } finally {
      loading.remove();
    }
  }
  const alive = added.filter(id => S.pages.some(p => p.uid === id)); // some may be undone/deleted meanwhile
  if (alive.length) {
    S.sel = new Set(alive);
    S.anchor = alive[0];
    render();
    if (S.step === 2) cards.get(alive[0])?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  showErrors(errs);
}
// A placeholder card per file while it loads: stage text + progress bar
// (indeterminate until the page count is known), so a big file never looks
// like a frozen page.
function loadingCard(name) {
  const el = document.createElement('div');
  el.className = 'card loading';
  el.setAttribute('role', 'status');
  el.innerHTML = '<div class="thumb"><div class="sheet"><span class="stage">讀取中…</span><progress></progress></div></div><div class="num">&nbsp;</div><div class="src"></div>';
  el.querySelector('.src').textContent = middleTruncate(name, 20);
  (S.step === 1 ? $('groups') : $('grid')).appendChild(el);
  $('empty').hidden = true;
  const bar = el.querySelector('progress');
  el.stage = (text, value, max) => {
    el.querySelector('.stage').textContent = text;
    if (max) { bar.max = max; bar.value = value; } else bar.removeAttribute('value');
  };
  return el;
}
$('file-input').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });

// Window-level drop: a PDF dropped anywhere must never make the browser open
// it (that would throw away the whole session).
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop-overlay').hidden = !!ctx.editorOpen(); });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
window.addEventListener('dragover', e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = ctx.editorOpen() ? 'none' : 'copy'; });
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  $('drop-overlay').hidden = true;
  if (!ctx.editorOpen() && e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]);
});
window.addEventListener('beforeunload', e => {
  if (S.pages.length && S.dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- grid rendering ----------
const cards = new Map(); // uid -> { el, sheet, canvas, svg, drawnKey }
const SVGNS = 'http://www.w3.org/2000/svg';

function middleTruncate(s, n) {
  return s.length <= n ? s : s.slice(0, Math.ceil(n / 2) - 1) + '…' + s.slice(s.length - Math.floor(n / 2));
}
function fitSize(p) {
  const k = Math.min(THUMB_BOX.w / p.w, THUMB_BOX.h / p.h);
  return { w: Math.round(p.w * k), h: Math.round(p.h * k) };
}
// Lazy thumbnails serve both views: jobs map an element to its card and to
// the page geometry it shows. A page already drawn elsewhere is copied, not
// rendered again.
const jobs = new WeakMap();
const drawnCanvas = new Map(); // "src:index" -> a canvas holding that thumbnail
function watch(el, c, info) { jobs.set(el, { c, info }); observer.observe(el); }
function forgetCard(c) {
  observer.unobserve(c.el);
  c.el.remove();
  for (const [k, cv] of drawnCanvas) if (cv === c.canvas) drawnCanvas.delete(k);
}
function makeSheet(el, p) {
  const c = { el, sheet: el.querySelector('.sheet'), canvas: el.querySelector('canvas'), svg: el.querySelector('svg'), drawnKey: null };
  const fs = fitSize(p);
  c.sheet.style.width = fs.w + 'px';
  c.sheet.style.height = fs.h + 'px';
  c.canvas.style.visibility = 'hidden';
  return c;
}
function makeCard(p) {
  const el = document.createElement('div');
  el.className = 'card';
  el.setAttribute('role', 'option');
  el.dataset.uid = p.uid;
  el.innerHTML = '<div class="thumb"><div class="sheet"><canvas></canvas><svg></svg></div></div><div class="num"></div><div class="src"></div>';
  const c = makeSheet(el, p);
  cards.set(p.uid, c);
  watch(el, c, () => S.pages.find(q => q.uid === p.uid));
  return c;
}

function render() {
  renderGrid();
  renderPicker();
  renderChrome();
}

function renderGrid() {
  const grid = $('grid');
  const live = new Set();
  S.pages.forEach((p, i) => {
    live.add(p.uid);
    const c = cards.get(p.uid) || makeCard(p);
    const fs = fitSize(p);
    if (c.sheet.style.width !== fs.w + 'px' || c.sheet.style.height !== fs.h + 'px') {
      c.sheet.style.width = fs.w + 'px';
      c.sheet.style.height = fs.h + 'px';
      c.canvas.style.visibility = 'hidden';
      queue.add(c.el); // redraw in the new orientation
    }
    if (grid.children[i] !== c.el) grid.insertBefore(c.el, grid.children[i] || null);
    c.el.querySelector('.num').textContent = i + 1;
    const src = S.sources.get(p.src);
    c.el.querySelector('.src').textContent = `${middleTruncate(src.name.replace(/\.pdf$/i, ''), 14)} · 第 ${p.index + 1} 頁`;
    c.el.title = `${src.name} 第 ${p.index + 1} 頁`;
    c.el.classList.toggle('selected', S.sel.has(p.uid));
    c.el.setAttribute('aria-selected', S.sel.has(p.uid));
    drawShapesSvg(c.svg, p, { outlines: true });
  });
  for (const [id, c] of cards) {
    if (!live.has(id)) { forgetCard(c); cards.delete(id); }
  }
  pump();
}

function renderChrome() {
  const n = S.pages.length, k = S.sel.size;
  const loading = document.querySelector('.card.loading') !== null;
  $('empty').hidden = S.sources.size > 0 || loading;
  $('picker').hidden = S.step !== 1 || (S.sources.size === 0 && !loading);
  $('grid').hidden = S.step !== 2;
  $('grid-empty').hidden = S.step !== 2 || n > 0 || S.sources.size === 0;
  $('step1-tab').setAttribute('aria-pressed', S.step === 1);
  $('step2-tab').setAttribute('aria-pressed', S.step === 2);
  for (const b of document.querySelectorAll('#toolbar .step2')) b.hidden = S.step !== 2 || b.dataset.off === '1';
  $('preview').hidden = !S.pvOpen;
  $('picker').classList.toggle('pv-closed', !S.pvOpen);
  $('pv-open').hidden = S.pvOpen || S.sources.size === 0;
  if (S.step === 1) {
    $('status').textContent = S.sources.size ? `共 ${S.sources.size} 份檔案，已選 ${n} 頁` : '';
  } else {
    $('status').textContent = n ? `共 ${n} 頁` + (k ? `，已選 ${k} 頁` : '') : (S.sources.size ? '還沒有選任何頁面，回「1 選頁」勾選' : '');
  }
  $('delete-btn').disabled = !k;
  $('rotate-btn').disabled = !k;
  $('dup-btn').disabled = !k;
  $('edit-btn').disabled = !n || !ctx.editorAvailable;
  $('undo-btn').disabled = !S.undo.length;
  $('download-btn').disabled = !n || S.busy;
}

// Shapes as SVG in display points; same viewBox as the PDF page, so what is
// drawn here is what assemble() writes. `outlines` adds a screen-only dashed
// outline to shapes that would be invisible on white (white fill / no border).
function hex(name) {
  const c = A.COLORS[name];
  return 'rgb(' + c.map(v => Math.round(v * 255)).join(',') + ')';
}
function shapeEl(s) {
  let el;
  const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2), w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
  if (s.type === 'line') {
    el = document.createElementNS(SVGNS, 'line');
    el.setAttribute('x1', s.x1); el.setAttribute('y1', s.y1); el.setAttribute('x2', s.x2); el.setAttribute('y2', s.y2);
  } else if (s.type === 'ellipse') {
    el = document.createElementNS(SVGNS, 'ellipse');
    el.setAttribute('cx', x + w / 2); el.setAttribute('cy', y + h / 2); el.setAttribute('rx', w / 2); el.setAttribute('ry', h / 2);
  } else {
    el = document.createElementNS(SVGNS, 'rect');
    el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', w); el.setAttribute('height', h);
    if (s.type === 'rrect') { const r = Math.min(A.RRECT_RADIUS, w / 2, h / 2); el.setAttribute('rx', r); el.setAttribute('ry', r); }
  }
  el.setAttribute('fill', s.type !== 'line' && s.fill ? hex(s.fill) : 'none');
  el.setAttribute('stroke', s.stroke ? hex(s.stroke) : 'none');
  el.setAttribute('stroke-width', s.stroke ? s.width : 0);
  return el;
}
function outlineEl(s) {
  if (s.type === 'line' || (s.stroke && s.fill !== 'white')) return null;
  const el = shapeEl({ ...s, fill: null, stroke: 'black', width: 1 });
  el.setAttribute('class', 'ghost-outline');
  el.removeAttribute('stroke'); el.removeAttribute('stroke-width'); el.removeAttribute('fill');
  return el;
}
function drawShapesSvg(svg, p, { outlines }) {
  svg.setAttribute('viewBox', `0 0 ${p.w} ${p.h}`);
  svg.textContent = '';
  for (const s of p.shapes) {
    const el = shapeEl(s);
    el.dataset.id = s.id;
    svg.appendChild(el);
    if (outlines) { const o = outlineEl(s); if (o) svg.appendChild(o); }
  }
}

// ---------- lazy thumbnails ----------
const queue = new Set();
const inFlight = new Set(); // a canvas must never get two concurrent renders
let rendering = 0;
const observer = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (e.isIntersecting) queue.add(e.target); else queue.delete(e.target);
  }
  pump();
}, { rootMargin: '400px 0px' });

function pump() {
  while (rendering < 2 && queue.size) {
    const el = queue.values().next().value;
    queue.delete(el);
    const job = jobs.get(el);
    const p = job && job.info();
    if (!p || !el.isConnected) continue;
    const c = job.c;
    const key = thumbKey(p);
    if (c.drawnKey === key || inFlight.has(el)) continue;
    rendering++;
    inFlight.add(el);
    drawThumb(c, p, key)
      .then(() => { delete c.sheet.dataset.failed; })
      .catch(e => { console.error(e); c.sheet.dataset.failed = '無法顯示縮圖'; })
      .finally(() => { inFlight.delete(el); rendering--; pump(); });
  }
}
const thumbKey = p => `${p.src}:${p.index}:${p.rot || 0}`;
async function drawThumb(c, p, key) {
  const fs = fitSize(p);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(fs.w * dpr), H = Math.round(fs.h * dpr);
  const ready = drawnCanvas.get(key);
  if (ready && ready !== c.canvas && ready.width === W && ready.height === H && ready.isConnected) {
    c.canvas.width = W; c.canvas.height = H;
    c.canvas.getContext('2d').drawImage(ready, 0, 0);
  } else {
    const page = await S.sources.get(p.src).doc.getPage(p.index + 1);
    const vp = page.getViewport({ scale: (fs.w / p.w) * dpr, rotation: (page.rotate + (p.rot || 0)) % 360 });
    c.canvas.width = Math.round(vp.width);
    c.canvas.height = Math.round(vp.height);
    // annotations are not carried into the output (assemble.js), so not shown
    await page.render({ canvas: c.canvas, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.DISABLE }).promise;
    page.cleanup(); // drop decoded images; a scanned page holds tens of MB
  }
  c.drawnKey = key;
  drawnCanvas.set(key, c.canvas);
  c.canvas.style.visibility = '';
}

// ---------- step 1: pick pages per file ----------
// Step 1 is a view of S.pages: a source page is ticked when some entry in
// S.pages shows it. Un-ticking parks those entries (shapes included) so
// ticking again brings them back; deleting in step 2 just removes them.
const pkey = (src, i) => src + ':' + i;
const isPicked = (src, i) => S.pages.some(p => p.src === src && p.index === i);
function pick(src, i, on) {
  const key = pkey(src, i);
  if (!on) {
    const gone = S.pages.filter(p => p.src === src && p.index === i);
    if (!gone.length) return;
    S.parked.set(key, gone);
    S.pages = S.pages.filter(p => !(p.src === src && p.index === i));
    for (const p of gone) S.sel.delete(p.uid);
    return;
  }
  if (isPicked(src, i)) return;
  const g = S.sources.get(src).geoms[i];
  const back = (S.parked.get(key) || [{ src, index: i, w: g.w, h: g.h, rotate: g.rotate, shapes: [] }])
    .map(p => ({ ...p, uid: uid(), shapes: p.shapes.map(sh => ({ ...sh })) }));
  S.parked.delete(key);
  // back into file order: after the last earlier page of the same file,
  // else before its first later page, else at the end
  let at = -1;
  S.pages.forEach((p, k) => { if (p.src === src && p.index < i) at = k; });
  if (at >= 0) at += 1;
  else { at = S.pages.findIndex(p => p.src === src && p.index > i); if (at < 0) at = S.pages.length; }
  S.pages.splice(at, 0, ...back);
}
function togglePick(src, i) {
  const on = !isPicked(src, i);
  commit(`${on ? '選回' : '不選'} ${S.sources.get(src).name} 第 ${i + 1} 頁`);
  pick(src, i, on);
  render();
}
function pickAll(src, on) {
  const n = S.sources.get(src).geoms.length;
  if ([...Array(n).keys()].every(i => isPicked(src, i) === on)) return;
  commit(`${on ? '全選' : '全不選'} ${S.sources.get(src).name}`);
  for (let i = 0; i < n; i++) pick(src, i, on);
  render();
}

const groupEls = new Map(); // source id -> { el, tiles: [{ el, c }] }
function renderPicker() {
  const host = $('groups');
  for (const [id, src] of S.sources) {
    let g = groupEls.get(id);
    if (!g) {
      const el = document.createElement('section');
      el.className = 'group';
      el.dataset.src = id;
      el.innerHTML = '<header><button class="fold" aria-expanded="true"></button><span class="gname"></span><span class="gcount"></span>' +
        '<button class="btn small" data-all="1">全選</button><button class="btn small" data-all="0">全不選</button></header><div class="tiles"></div>';
      el.querySelector('.gname').textContent = src.name;
      el.querySelector('.gname').title = src.name;
      const tiles = src.geoms.map((geo, i) => {
        const t = document.createElement('div');
        t.className = 'tile';
        t.tabIndex = -1;
        t.dataset.key = pkey(id, i);
        t.innerHTML = '<div class="thumb"><div class="sheet"><canvas></canvas><svg></svg></div></div>' +
          '<label class="tick"><input type="checkbox"><span></span></label>';
        t.querySelector('.tick span').textContent = `第 ${i + 1} 頁`;
        const c = makeSheet(t, geo);
        watch(t, c, () => ({ src: id, index: i, w: geo.w, h: geo.h, rotate: geo.rotate }));
        return { el: t, c };
      });
      for (const t of tiles) el.querySelector('.tiles').appendChild(t.el);
      // keep groups in upload order, ahead of any loading cards
      host.insertBefore(el, host.querySelector('.card.loading'));
      g = { el, tiles };
      groupEls.set(id, g);
    }
    const n = src.geoms.length;
    let picked = 0;
    g.tiles.forEach((t, i) => {
      const on = isPicked(id, i);
      if (on) picked++;
      t.el.classList.toggle('off', !on);
      t.el.querySelector('input').checked = on;
      t.el.classList.toggle('focus', S.focus === pkey(id, i));
      const entry = S.pages.find(p => p.src === id && p.index === i);
      drawShapesSvg(t.c.svg, entry || { w: src.geoms[i].w, h: src.geoms[i].h, shapes: [] }, { outlines: true });
    });
    const folded = S.collapsed.has(id);
    g.el.classList.toggle('folded', folded);
    g.el.querySelector('.fold').setAttribute('aria-expanded', !folded);
    g.el.querySelector('.fold').setAttribute('aria-label', folded ? '展開' : '收合');
    g.el.querySelector('.gcount').textContent = `已選 ${picked} / ${n} 頁`;
  }
  renderPreview();
}

$('groups').addEventListener('click', e => {
  const group = e.target.closest('.group');
  if (!group) return;
  const src = group.dataset.src;
  if (e.target.closest('.fold')) {
    if (S.collapsed.has(src)) S.collapsed.delete(src); else S.collapsed.add(src);
    return render();
  }
  const all = e.target.closest('[data-all]');
  if (all) return pickAll(src, all.dataset.all === '1');
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const [, i] = tile.dataset.key.split(':');
  S.focus = tile.dataset.key;
  if (e.target.closest('.tick')) {
    e.preventDefault(); // the label would toggle the box itself; state comes from S.pages
    return togglePick(src, Number(i));
  }
  tile.focus({ preventScroll: true });
  render();
});

// The big preview: the focused page drawn to fit the panel.
let pvTask = null, pvShown = null;
async function renderPreview() {
  if (S.step !== 1 || !S.pvOpen || !S.focus) return;
  const [src, si] = S.focus.split(':');
  const source = S.sources.get(src);
  if (!source) return;
  const i = Number(si);
  const geo = source.geoms[i];
  const entry = S.pages.find(p => p.src === src && p.index === i);
  const shown = { w: geo.w, h: geo.h, shapes: entry ? entry.shapes : [] };
  $('pv-label').textContent = `${source.name} · 第 ${i + 1} 頁${isPicked(src, i) ? '' : '（未選）'}`;
  drawShapesSvg($('pv-svg'), shown, { outlines: true });
  const stage = $('pv-stage').getBoundingClientRect();
  const k = Math.min((stage.width - 24) / geo.w, (stage.height - 24) / geo.h);
  if (!(k > 0)) return;
  $('pv-page').style.width = Math.round(geo.w * k) + 'px';
  $('pv-page').style.height = Math.round(geo.h * k) + 'px';
  const want = `${S.focus}@${Math.round(k * 100)}`;
  if (pvShown === want) return;
  pvShown = want;
  if (pvTask) { pvTask.cancel(); pvTask = null; }
  const page = await source.doc.getPage(i + 1);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: k * dpr });
  const off = document.createElement('canvas');
  off.width = Math.round(vp.width); off.height = Math.round(vp.height);
  pvTask = page.render({ canvas: off, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.DISABLE });
  try {
    await pvTask.promise;
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') { console.error(e); pvShown = null; }
    return;
  } finally {
    page.cleanup();
  }
  if (pvShown !== want) return;
  const cv = $('pv-canvas');
  cv.width = off.width; cv.height = off.height;
  cv.getContext('2d').drawImage(off, 0, 0);
  cv.dataset.key = S.focus;
}
$('pv-toggle').onclick = () => { S.pvOpen = false; pvShown = null; render(); };
$('pv-open').onclick = () => { S.pvOpen = true; render(); };
window.addEventListener('resize', () => { pvShown = null; renderPreview(); });

// visible tiles in reading order (folded groups skipped)
function moveFocus(d) {
  const tiles = [...document.querySelectorAll('#groups .group:not(.folded) .tile')];
  if (!tiles.length) return;
  let k = tiles.findIndex(t => t.dataset.key === S.focus);
  k = k < 0 ? 0 : Math.max(0, Math.min(tiles.length - 1, k + d));
  S.focus = tiles[k].dataset.key;
  tiles[k].focus({ preventScroll: true });
  tiles[k].scrollIntoView({ block: 'nearest' });
  render();
}

function setStep(n) {
  if (S.step === n) return;
  S.step = n;
  S.sel.clear();
  pvShown = null;
  render();
}
$('step1-tab').onclick = () => setStep(1);
$('step2-tab').onclick = () => setStep(2);

// ---------- selection & drag-reorder ----------
const indexOf = id => S.pages.findIndex(p => p.uid === id);
let press = null; // { id, x, y, dragging, touch, cx, cy }

$('grid').addEventListener('pointerdown', e => {
  const el = e.target.closest('.card[data-uid]');
  if (!el || e.button !== 0) return;
  press = { id: el.dataset.uid, x: e.clientX, y: e.clientY, dragging: false, touch: e.pointerType === 'touch' };
  if (!press.touch) el.setPointerCapture(e.pointerId);
});
$('grid').addEventListener('pointermove', e => {
  if (!press) return;
  if (!press.dragging) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
    if (press.touch) { press = null; return; } // a finger moving is a scroll, not a reorder
    if (!S.sel.has(press.id)) { S.sel = new Set([press.id]); S.anchor = press.id; render(); }
    press.dragging = true;
    for (const id of S.sel) cards.get(id)?.el.classList.add('dragging');
    $('drag-ghost').textContent = `${S.sel.size} 頁`;
    $('drag-ghost').hidden = false;
    autoScroll.start();
  }
  press.cx = e.clientX; press.cy = e.clientY;
  $('drag-ghost').style.left = e.clientX + 14 + 'px';
  $('drag-ghost').style.top = e.clientY + 14 + 'px';
  updateInsert(e.clientX, e.clientY);
});
$('grid').addEventListener('pointerup', e => {
  if (!press) return;
  const p = press;
  press = null;
  if (p.dragging) return finishDrag(p);
  clickSelect(p.id, e);
});
$('grid').addEventListener('pointercancel', () => { if (press?.dragging) endDragUi(); press = null; insertAt = null; });
$('grid').addEventListener('dblclick', e => {
  const el = e.target.closest('.card[data-uid]');
  if (el && ctx.editorAvailable) ctx.openEditor(el.dataset.uid);
});
$('grid-wrap').addEventListener('pointerdown', e => {
  if (e.target === $('grid-wrap') || e.target === $('grid')) { S.sel.clear(); render(); }
});

function clickSelect(id, e) {
  if (e.ctrlKey || e.metaKey) {
    if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
    S.anchor = id;
  } else if (e.shiftKey && S.anchor && indexOf(S.anchor) >= 0) {
    const a = indexOf(S.anchor), b = indexOf(id);
    S.sel = new Set(S.pages.slice(Math.min(a, b), Math.max(a, b) + 1).map(p => p.uid));
  } else {
    S.sel = new Set([id]);
    S.anchor = id;
  }
  render();
}

// Insertion slot = index in S.pages before which the dragged block lands.
let insertAt = null;
function updateInsert(x, y) {
  const bar = $('insert-bar');
  const el = document.elementFromPoint(x, y)?.closest('.card[data-uid]');
  if (!el) { return; }
  const r = el.getBoundingClientRect();
  const after = x > r.left + r.width / 2;
  insertAt = indexOf(el.dataset.uid) + (after ? 1 : 0);
  bar.style.left = (after ? r.right + 6 : r.left - 9) + 'px';
  bar.style.top = r.top + 'px';
  bar.style.height = r.height + 'px';
  bar.hidden = false;
}
function endDragUi() {
  autoScroll.stop();
  $('drag-ghost').hidden = true;
  $('insert-bar').hidden = true;
  for (const c of cards.values()) c.el.classList.remove('dragging');
}
function finishDrag() {
  endDragUi();
  if (insertAt == null) return;
  const moving = S.pages.filter(p => S.sel.has(p.uid));
  const before = snapshot();
  let at = insertAt;
  for (let i = 0; i < insertAt; i++) if (S.sel.has(S.pages[i]?.uid)) at--;
  const rest = S.pages.filter(p => !S.sel.has(p.uid));
  const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  insertAt = null;
  if (next.every((p, i) => p === S.pages[i])) return render();
  S.pages = next;
  commit(`移動 ${moving.length} 頁`, before);
  render();
}
const autoScroll = (() => {
  let raf = 0;
  function tick() {
    if (press?.dragging && press.cy != null) {
      const edge = 70, h = window.innerHeight;
      let v = 0;
      if (press.cy < edge) v = -(edge - press.cy) / 3;
      else if (press.cy > h - edge) v = (press.cy - (h - edge)) / 3;
      if (v) { window.scrollBy(0, v); updateInsert(press.cx, press.cy); }
    }
    raf = requestAnimationFrame(tick);
  }
  return { start() { if (!raf) raf = requestAnimationFrame(tick); }, stop() { cancelAnimationFrame(raf); raf = 0; } };
})();

// ---------- page commands ----------
function deleteSelected() {
  if (!S.sel.size) return;
  const n = S.sel.size;
  commit(`刪除 ${n} 頁`);
  for (const p of S.pages) if (S.sel.has(p.uid)) S.parked.delete(pkey(p.src, p.index));
  S.pages = S.pages.filter(p => !S.sel.has(p.uid));
  S.sel.clear();
  render();
}
// Turn a page 90° clockwise. Its shapes turn with it, so they stay on the
// same content: a display point (x, y) of a W×H page goes to (H − y, x).
function rotateEntry(p) {
  const H = p.h;
  for (const s of p.shapes) {
    const n = { x1: H - s.y1, y1: s.x1, x2: H - s.y2, y2: s.x2 };
    if (s.type !== 'line') Object.assign(n, { x1: Math.min(n.x1, n.x2), x2: Math.max(n.x1, n.x2), y1: Math.min(n.y1, n.y2), y2: Math.max(n.y1, n.y2) });
    Object.assign(s, n);
  }
  [p.w, p.h] = [p.h, p.w];
  p.rot = ((p.rot || 0) + 90) % 360;
  p.rotate = (p.rotate + 90) % 360;
}
function rotateSelected() {
  if (!S.sel.size) return;
  commit(`向右轉 ${S.sel.size} 頁`);
  for (const p of S.pages) if (S.sel.has(p.uid)) rotateEntry(p);
  render();
}
function duplicateSelected() {
  if (!S.sel.size) return;
  commit(`複製 ${S.sel.size} 頁`);
  const chosen = S.pages.filter(p => S.sel.has(p.uid));
  const copies = chosen.map(p => ({ ...p, uid: uid(), shapes: p.shapes.map(s => ({ ...s, id: 'h' + (nextId++) })) }));
  const last = Math.max(...chosen.map(p => indexOf(p.uid)));
  S.pages.splice(last + 1, 0, ...copies);
  S.sel = new Set(copies.map(p => p.uid));
  S.anchor = copies[0].uid;
  render();
}
// ---------- image-version output ----------
const RASTER_JPEG_QUALITY = 0.92;
const MAX_CANVAS_SIDE = 16384; // browsers refuse larger canvases

// Each page drawn by pdf.js at `dpi` (rotation applied), the shapes burned in
// with the very SVG the preview shows, then one JPEG per page in a fresh PDF.
// Nothing but pixels is carried over: the print matches the preview, and no
// object of a deleted page (or text under a white box) can come along.
async function rasterize(pages, dpi, onProgress) {
  const out = await window.PDFLib.PDFDocument.create();
  for (let i = 0; i < pages.length; i++) {
    onProgress(i + 1, pages.length);
    const p = pages[i];
    const page = await S.sources.get(p.src).doc.getPage(p.index + 1);
    const vp = page.getViewport({ scale: Math.min(dpi / 72, MAX_CANVAS_SIDE / Math.max(p.w, p.h)), rotation: (page.rotate + (p.rot || 0)) % 360 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    try {
      await page.render({ canvas, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.DISABLE }).promise;
    } finally {
      page.cleanup();
    }
    if (p.shapes.length) await burnShapes(g, p, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', RASTER_JPEG_QUALITY));
    canvas.width = canvas.height = 0; // free the bitmap before the next page
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    out.addPage([p.w, p.h]).drawImage(img, { x: 0, y: 0, width: p.w, height: p.h });
  }
  return out.save();
}
async function burnShapes(g, p, w, h) {
  const svg = document.createElementNS(SVGNS, 'svg');
  drawShapesSvg(svg, p, { outlines: false }); // dashed outlines are screen-only
  svg.setAttribute('xmlns', SVGNS);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('preserveAspectRatio', 'none');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    g.drawImage(img, 0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// dpi 0 = original (vector) output; 300 / 600 = image version
async function download(dpi = 0) {
  if (!S.pages.length || S.busy) return;
  S.busy = true;
  const btn = $('download-btn');
  btn.textContent = '產生中…';
  render();
  // let "產生中…" paint before the main thread is busy assembling
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  try {
    const pages = snapshot(); // edits made while assembling must not leak into this file
    const rev = S.rev;
    const used = new Set(pages.map(p => p.src));
    let bytes;
    if (dpi) {
      bytes = await rasterize(pages, dpi, (i, n) => { btn.textContent = `產生中… ${i}/${n}`; });
    } else {
      const sources = [...S.sources.values()].filter(s => used.has(s.id)).map(s => ({ id: s.id, bytes: s.bytes.slice() }));
      bytes = (await inWorker({ op: 'assemble', sources, pages }, sources.map(s => s.bytes.buffer))).bytes;
    }
    const first = S.sources.get(pages[0].src).name.replace(/\.pdf$/i, '');
    const name = `${first}-${used.size > 1 ? '合併' : '整理'}${dpi ? `-圖片${dpi}dpi` : ''}.pdf`;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    if (S.rev === rev) S.dirty = false; // otherwise newer edits are not in this file
    toast('已下載：' + name);
  } catch (e) {
    console.error(e);
    const msg = (e && e.message) || '';
    // refusals that protect what the user deleted get their own wording
    const why = /cannot be checked/.test(msg) ? '這份 PDF 有頁面的內容格式沒辦法檢查，為了不把刪掉的頁面一起帶出去，先不產生檔案。可以把檔案寄給 Yves 看看。'
      : /not chosen/.test(msg) ? '輸出檔會帶到沒選的頁面，已停止。可以把檔案寄給 Yves 看看。'
        : '頁面都還在，可以再按一次下載；還是失敗請截圖給 Yves。';
    showErrors([`產生 PDF 失敗：${why}　${msg}`]);
  } finally {
    S.busy = false;
    btn.textContent = '下載 PDF';
    render();
  }
}
$('delete-btn').onclick = deleteSelected;
$('rotate-btn').onclick = rotateSelected;
$('dup-btn').onclick = duplicateSelected;
$('add-btn').onclick = () => $('file-input').click();
$('undo-btn').onclick = undo;
$('download-btn').onclick = () => {
  if (!S.pages.length || S.busy) return;
  $('dl-dialog').querySelector('input[value="0"]').checked = true; // default: original
  $('dl-dialog').showModal();
};
$('dl-dialog').addEventListener('close', () => {
  if ($('dl-dialog').returnValue !== 'ok') return;
  download(Number($('dl-dialog').querySelector('input[name="q"]:checked').value));
});
$('edit-btn').onclick = () => {
  const id = [...S.sel][0] || S.pages[0]?.uid;
  if (id && ctx.editorAvailable) ctx.openEditor(id);
};

document.addEventListener('keydown', e => {
  if (ctx.editorOpen() || $('dl-dialog').open) return; // those have their own keys
  if (e.target.closest && e.target.closest('textarea, input:not([type=checkbox])')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (S.step === 1) {
    if (e.target.closest && e.target.closest('button')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
    else if (e.key === ' ' && S.focus) { e.preventDefault(); const [src, i] = S.focus.split(':'); togglePick(src, Number(i)); }
    return;
  }
  if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); S.sel = new Set(S.pages.map(p => p.uid)); render(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (S.sel.size) { e.preventDefault(); deleteSelected(); } }
  else if (e.key === 'Escape') { S.sel.clear(); render(); }
  else if ((e.key === 'r' || e.key === 'R') && !mod && S.sel.size) { e.preventDefault(); rotateSelected(); }
});

// Shared with the shape editor (editor.js).
export const ctx = {
  S, pdfjsLib, A, setStep, snapshot, commit, undo, render, toast, drawShapesSvg, shapeEl, outlineEl, newId: () => 'h' + (nextId++),
  editorAvailable: false,
  editorOpen: () => false,
  editorGesture: () => false,
  openEditor: () => {},
  onUndo: () => {},
};
window.__pdfTool = ctx; // test hook, and boot-check.js's "the tool loaded" signal
render();
