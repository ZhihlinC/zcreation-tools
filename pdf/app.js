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
      const bytes = new Uint8Array(await f.arrayBuffer());
      const r = await A.openSource(pdfjsLib, window.PDFLib, bytes, PDFJS_PARAMS);
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
        const pg = await r.doc.getPage(i + 1);
        const [x1, y1, x2, y2] = pg.view;
        const g = A.geom(pg.rotate, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
        fresh.push({ uid: uid(), src: id, index: i, w: g.w, h: g.h, rotate: g.rotate, shapes: [] });
      }
      // one synchronous step per file, so edits made while it loaded and the
      // undo stack stay consistent
      S.sources.set(id, { id, name: f.name, bytes, doc: r.doc });
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
    cards.get(alive[0])?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  showErrors(errs);
}
function loadingCard(name) {
  const el = document.createElement('div');
  el.className = 'card loading';
  el.innerHTML = '<div class="thumb"><div class="sheet">讀取中…</div></div><div class="num">&nbsp;</div><div class="src"></div>';
  el.querySelector('.src').textContent = middleTruncate(name, 20);
  $('grid').appendChild(el);
  $('empty').hidden = true;
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
function makeCard(p) {
  const el = document.createElement('div');
  el.className = 'card';
  el.setAttribute('role', 'option');
  el.dataset.uid = p.uid;
  el.innerHTML = '<div class="thumb"><div class="sheet"><canvas></canvas><svg></svg></div></div><div class="num"></div><div class="src"></div>';
  const c = { el, sheet: el.querySelector('.sheet'), canvas: el.querySelector('canvas'), svg: el.querySelector('svg'), drawnKey: null };
  const fs = fitSize(p);
  c.sheet.style.width = fs.w + 'px';
  c.sheet.style.height = fs.h + 'px';
  c.canvas.style.visibility = 'hidden';
  cards.set(p.uid, c);
  observer.observe(el);
  return c;
}

function render() {
  const grid = $('grid');
  const live = new Set();
  S.pages.forEach((p, i) => {
    live.add(p.uid);
    const c = cards.get(p.uid) || makeCard(p);
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
    if (!live.has(id)) { observer.unobserve(c.el); c.el.remove(); cards.delete(id); }
  }
  // leftover loading cards stay after the pages
  $('empty').hidden = S.pages.length > 0 || grid.querySelector('.loading') !== null;
  const n = S.pages.length, k = S.sel.size;
  $('status').textContent = n ? `共 ${n} 頁` + (k ? `，已選 ${k} 頁` : '') : '';
  $('delete-btn').disabled = !k;
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
    const id = e.target.dataset.uid;
    if (e.isIntersecting) queue.add(id); else queue.delete(id);
  }
  pump();
}, { rootMargin: '400px 0px' });

function pump() {
  while (rendering < 2 && queue.size) {
    const id = queue.values().next().value;
    queue.delete(id);
    const c = cards.get(id), p = S.pages.find(q => q.uid === id);
    if (!c || !p) continue;
    const key = p.src + ':' + p.index;
    if (c.drawnKey === key || inFlight.has(id)) continue;
    rendering++;
    inFlight.add(id);
    drawThumb(c, p, key)
      .then(() => { delete c.sheet.dataset.failed; })
      .catch(e => { console.error(e); c.sheet.dataset.failed = '無法顯示縮圖'; })
      .finally(() => { inFlight.delete(id); rendering--; pump(); });
  }
}
async function drawThumb(c, p, key) {
  const page = await S.sources.get(p.src).doc.getPage(p.index + 1);
  const fs = fitSize(p);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: (fs.w / p.w) * dpr });
  c.canvas.width = Math.round(vp.width);
  c.canvas.height = Math.round(vp.height);
  // annotations are not carried into the output (assemble.js), so not shown
  await page.render({ canvas: c.canvas, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.DISABLE }).promise;
  page.cleanup(); // drop decoded images; a scanned page holds tens of MB
  c.drawnKey = key;
  c.canvas.style.visibility = '';
}

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
  S.pages = S.pages.filter(p => !S.sel.has(p.uid));
  S.sel.clear();
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
async function download() {
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
    const sources = [...S.sources.values()].filter(s => used.has(s.id)).map(s => ({ id: s.id, bytes: s.bytes }));
    const bytes = await A.assemble(window.PDFLib, sources, pages);
    const first = S.sources.get(pages[0].src).name.replace(/\.pdf$/i, '');
    const name = used.size > 1 ? `${first}-合併.pdf` : `${first}-整理.pdf`;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    if (S.rev === rev) S.dirty = false; // otherwise newer edits are not in this file
    toast('已下載：' + name);
  } catch (e) {
    console.error(e);
    showErrors([`產生 PDF 失敗（頁面都還在，可以再按一次下載；還是失敗請截圖給 Yves）　${e && e.message ? e.message : ''}`]);
  } finally {
    S.busy = false;
    btn.textContent = '下載 PDF';
    render();
  }
}
$('delete-btn').onclick = deleteSelected;
$('dup-btn').onclick = duplicateSelected;
$('add-btn').onclick = () => $('file-input').click();
$('undo-btn').onclick = undo;
$('download-btn').onclick = download;
$('edit-btn').onclick = () => {
  const id = [...S.sel][0] || S.pages[0]?.uid;
  if (id && ctx.editorAvailable) ctx.openEditor(id);
};

document.addEventListener('keydown', e => {
  if (ctx.editorOpen()) return; // the editor has its own keys
  if (e.target.closest && e.target.closest('input, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); S.sel = new Set(S.pages.map(p => p.uid)); render(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (S.sel.size) { e.preventDefault(); deleteSelected(); } }
  else if (e.key === 'Escape') { S.sel.clear(); render(); }
});

// Shared with the shape editor (editor.js).
export const ctx = {
  S, pdfjsLib, A, snapshot, commit, undo, render, toast, drawShapesSvg, shapeEl, outlineEl, newId: () => 'h' + (nextId++),
  editorAvailable: false,
  editorOpen: () => false,
  editorGesture: () => false,
  openEditor: () => {},
  onUndo: () => {},
};
window.__pdfTool = ctx; // test hook, and boot-check.js's "the tool loaded" signal
render();
