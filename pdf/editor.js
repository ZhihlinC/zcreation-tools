// Shape editor overlay: draw / move / resize / delete rect, rounded rect,
// ellipse and line on one page. Shapes live in display points (the SVG
// viewBox), the same space assemble() reads.
import { ctx } from './app.js';

const { S, A } = ctx;
const $ = id => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const COLOR_NAMES = { black: '黑', white: '白', red: '紅', blue: '藍', green: '綠', yellow: '黃' };
const WIDTHS = [1, 2, 4, 8];
const MIN_SIZE = 3; // pt; smaller drags are treated as clicks

const E = {
  open: false,
  uid: null,
  tool: 'rect',
  selId: null,
  ready: false,
  // separate defaults so a line always has a stroke
  shapeStyle: { fill: 'white', stroke: null, width: 2 },
  lineStyle: { stroke: 'black', width: 2 },
  renderTask: null,
};
const svg = $('ed-svg');
const page = () => S.pages.find(p => p.uid === E.uid);
const selShape = () => page()?.shapes.find(s => s.id === E.selId) || null;

// ---------- toolbar ----------
function buildBar() {
  for (const b of $('ed-tools').querySelectorAll('button')) b.onclick = () => { E.tool = b.dataset.tool; E.selId = null; refresh(); };
  const mk = (group, kind) => {
    const none = document.createElement('button');
    none.textContent = '無';
    none.dataset.val = '';
    none.title = kind === 'fill' ? '無填色' : '無框線';
    $(group).appendChild(none);
    for (const [name, zh] of Object.entries(COLOR_NAMES)) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.val = name;
      b.title = zh;
      b.setAttribute('aria-label', zh);
      const c = A.COLORS[name].map(v => Math.round(v * 255));
      b.style.background = `rgb(${c})`;
      $(group).appendChild(b);
    }
    for (const b of $(group).querySelectorAll('button')) b.onclick = () => setStyle(kind, b.dataset.val || null);
  };
  mk('ed-fill', 'fill');
  mk('ed-stroke', 'stroke');
  for (const w of WIDTHS) {
    const b = document.createElement('button');
    b.dataset.val = w;
    b.title = w + ' pt';
    b.innerHTML = `<svg viewBox="0 0 20 20"><line x1="3" y1="10" x2="17" y2="10" style="stroke-width:${Math.min(w, 6)}"/></svg>`;
    b.onclick = () => setStyle('width', w);
    $('ed-width').appendChild(b);
  }
  $('ed-prev').onclick = () => go(-1);
  $('ed-next').onclick = () => go(1);
  $('ed-done').onclick = close;
}

// The style the toolbar is showing: the selected shape's, else the default
// for the current tool.
function currentStyle() {
  const s = selShape();
  if (s) return { isLine: s.type === 'line', fill: s.fill, stroke: s.stroke, width: s.width };
  const isLine = E.tool === 'line';
  const d = isLine ? E.lineStyle : E.shapeStyle;
  return { isLine, fill: isLine ? null : d.fill, stroke: d.stroke, width: d.width };
}
function setStyle(kind, val) {
  const s = selShape();
  const isLine = s ? s.type === 'line' : E.tool === 'line';
  const target = isLine ? E.lineStyle : E.shapeStyle;
  if (kind === 'fill' && isLine) return;
  target[kind] = val;
  if (s) {
    const before = ctx.snapshot();
    s[kind] = val;
    ctx.commit('改圖形樣式', before);
    ctx.render();
  }
  refresh();
}

function refreshBar() {
  const st = currentStyle();
  for (const b of $('ed-tools').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.tool === E.tool);
  for (const b of $('ed-fill').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', !st.isLine && (b.dataset.val || null) === st.fill);
    // fill and stroke can't both be "none": disable the other side's 無
    b.disabled = st.isLine || (b.dataset.val === '' && !st.stroke);
  }
  for (const b of $('ed-stroke').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', (b.dataset.val || null) === st.stroke);
    b.disabled = b.dataset.val === '' && (st.isLine || !st.fill);
  }
  for (const b of $('ed-width').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', Number(b.dataset.val) === st.width);
    b.disabled = !st.stroke;
  }
  $('ed-hint').hidden = !(st.fill === 'white' && !st.isLine);
  const i = S.pages.findIndex(p => p.uid === E.uid);
  $('ed-pos').textContent = `${i + 1} / ${S.pages.length}`;
  $('ed-prev').disabled = i <= 0;
  $('ed-next').disabled = i >= S.pages.length - 1;
  svg.classList.toggle('drawing', E.tool !== 'select');
}

// ---------- page display ----------
function layoutPage() {
  const p = page();
  const stage = $('ed-stage').getBoundingClientRect();
  const k = Math.min((stage.width - 48) / p.w, (stage.height - 48) / p.h);
  const el = $('ed-page');
  el.style.width = Math.round(p.w * k) + 'px';
  el.style.height = Math.round(p.h * k) + 'px';
  return k;
}
async function showPage() {
  const p = page();
  E.ready = false;
  if (E.renderTask) { E.renderTask.cancel(); E.renderTask = null; }
  const k = layoutPage();
  const canvas = $('ed-canvas');
  // show the grid thumbnail scaled up until the sharp render arrives
  const thumb = document.querySelector(`.card[data-uid="${p.uid}"] canvas`);
  if (thumb && thumb.width) { canvas.width = thumb.width; canvas.height = thumb.height; canvas.getContext('2d').drawImage(thumb, 0, 0); }
  else { canvas.width = 1; canvas.height = 1; }
  refresh();
  const uidAtStart = p.uid;
  const pdfPage = await S.sources.get(p.src).doc.getPage(p.index + 1);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = pdfPage.getViewport({ scale: k * dpr });
  const off = document.createElement('canvas');
  off.width = Math.round(vp.width); off.height = Math.round(vp.height);
  E.renderTask = pdfPage.render({ canvas: off, viewport: vp });
  try { await E.renderTask.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
  if (!E.open || E.uid !== uidAtStart) return;
  canvas.width = off.width; canvas.height = off.height;
  canvas.getContext('2d').drawImage(off, 0, 0);
  E.ready = true;
  svg.dataset.ready = '1';
}

function refresh() {
  const p = page();
  if (!p) return;
  ctx.drawShapesSvg(svg, p, { outlines: true });
  const s = selShape();
  if (s) drawSelection(s);
  refreshBar();
}
function handleSize() { return 9 * (page().w / $('ed-page').getBoundingClientRect().width); }
function drawSelection(s) {
  const hs = handleSize();
  const add = (tag, attrs) => { const el = document.createElementNS(SVGNS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); svg.appendChild(el); return el; };
  if (s.type === 'line') {
    add('line', { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, class: 'sel-box' });
  } else {
    add('rect', { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), width: Math.abs(s.x2 - s.x1), height: Math.abs(s.y2 - s.y1), class: 'sel-box' });
  }
  const pts = s.type === 'line' ? [['1', s.x1, s.y1], ['2', s.x2, s.y2]]
    : [['tl', s.x1, s.y1], ['tr', s.x2, s.y1], ['bl', s.x1, s.y2], ['br', s.x2, s.y2]];
  for (const [h, x, y] of pts) add('rect', { x: x - hs / 2, y: y - hs / 2, width: hs, height: hs, class: 'handle', 'data-handle': h });
}

// ---------- pointer ----------
function toPage(e) {
  const r = svg.getBoundingClientRect(), p = page();
  return [(e.clientX - r.left) / r.width * p.w, (e.clientY - r.top) / r.height * p.h];
}
let act = null; // { mode: 'create'|'move'|'resize', ... }

svg.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !E.ready) return;
  const [x, y] = toPage(e);
  const handle = e.target.dataset?.handle;
  const hitId = e.target.dataset?.id;
  svg.setPointerCapture(e.pointerId);
  if (handle && selShape()) {
    act = { mode: 'resize', handle, before: ctx.snapshot(), moved: false };
  } else if (hitId) {
    E.selId = hitId;
    const s = selShape();
    act = { mode: 'move', x, y, orig: { ...s }, before: ctx.snapshot(), moved: false };
    refresh();
  } else if (E.tool === 'select') {
    E.selId = null;
    act = null;
    refresh();
  } else {
    E.selId = null;
    const d = E.tool === 'line' ? E.lineStyle : E.shapeStyle;
    act = { mode: 'create', shape: { id: ctx.newId(), type: E.tool, x1: x, y1: y, x2: x, y2: y, fill: E.tool === 'line' ? null : d.fill, stroke: d.stroke, width: d.width } };
  }
});
svg.addEventListener('pointermove', e => {
  if (!act) return;
  const [x, y] = toPage(e);
  const p = page();
  if (act.mode === 'create') {
    Object.assign(act.shape, { x2: x, y2: y });
    refresh();
    const el = ctx.shapeEl(act.shape);
    svg.appendChild(el);
    const o = ctx.outlineEl(act.shape); if (o) svg.appendChild(o);
  } else if (act.mode === 'move') {
    const s = selShape(), dx = x - act.x, dy = y - act.y;
    Object.assign(s, { x1: act.orig.x1 + dx, y1: act.orig.y1 + dy, x2: act.orig.x2 + dx, y2: act.orig.y2 + dy });
    act.moved = act.moved || dx !== 0 || dy !== 0;
    refresh();
  } else if (act.mode === 'resize') {
    const s = selShape(), h = act.handle;
    if (h === '1') { s.x1 = x; s.y1 = y; }
    else if (h === '2') { s.x2 = x; s.y2 = y; }
    else {
      if (h[1] === 'l') s.x1 = x; else s.x2 = x;
      if (h[0] === 't') s.y1 = y; else s.y2 = y;
    }
    act.moved = true;
    refresh();
  }
  void p;
});
svg.addEventListener('pointerup', () => {
  if (!act) return;
  const a = act;
  act = null;
  if (a.mode === 'create') {
    const s = a.shape;
    const big = s.type === 'line' ? Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= MIN_SIZE : Math.abs(s.x2 - s.x1) >= MIN_SIZE && Math.abs(s.y2 - s.y1) >= MIN_SIZE;
    if (big) {
      ctx.commit('新增圖形');
      page().shapes.push(normalize(s));
      E.selId = s.id;
      ctx.render();
    }
  } else if (a.moved) {
    const s = selShape();
    Object.assign(s, normalize(s));
    ctx.commit(a.mode === 'move' ? '移動圖形' : '縮放圖形', a.before);
    ctx.render();
  }
  refresh();
});
// rect-like shapes keep x1<x2, y1<y2 so corner handles stay meaningful
function normalize(s) {
  if (s.type === 'line') return s;
  return Object.assign(s, { x1: Math.min(s.x1, s.x2), x2: Math.max(s.x1, s.x2), y1: Math.min(s.y1, s.y2), y2: Math.max(s.y1, s.y2) });
}

// ---------- open / close / navigate ----------
function open(uid) {
  E.open = true;
  E.uid = uid;
  E.selId = null;
  svg.dataset.ready = '';
  $('editor').hidden = false;
  showPage();
}
function close() {
  E.open = false;
  E.selId = null;
  if (E.renderTask) E.renderTask.cancel();
  $('editor').hidden = true;
  ctx.render();
}
function go(d) {
  const i = S.pages.findIndex(p => p.uid === E.uid) + d;
  if (i < 0 || i >= S.pages.length) return;
  E.uid = S.pages[i].uid;
  E.selId = null;
  svg.dataset.ready = '';
  showPage();
}

document.addEventListener('keydown', e => {
  if (!E.open) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); ctx.undo(); }
  else if (e.key === 'Escape') { e.preventDefault(); close(); }
  else if (e.key === 'PageDown') { e.preventDefault(); go(1); }
  else if (e.key === 'PageUp') { e.preventDefault(); go(-1); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selShape()) {
    e.preventDefault();
    ctx.commit('刪除圖形');
    const p = page();
    p.shapes = p.shapes.filter(s => s.id !== E.selId);
    E.selId = null;
    ctx.render();
    refresh();
  }
});
window.addEventListener('resize', () => { if (E.open) showPage(); });

buildBar();
ctx.editorAvailable = true;
ctx.editorOpen = () => E.open;
ctx.openEditor = open;
// Undo can remove the page being edited (e.g. undoing a duplicate).
ctx.onUndo = () => {
  if (!E.open) return;
  if (!page()) return close();
  if (!selShape()) E.selId = null;
  refresh();
};
ctx.render();
