// Sound Coverage Sketch — coverage.js
// M1 implementation. SPEC.md is the source of truth.
//
// World coordinate system (SPEC §4, audience POV):
//   +X = right, +Y = forward (toward stage), +Z = up. Right-handed:
//   +X × +Y = +Z. Origin (0,0,0) = floor projection of the listening centre.
//
// p5 WEBGL handedness reconciliation: p5's perspective() bakes a Y-flip into
// the projection matrix (the "-f * yScale" entry), which makes world +Y
// appear screen-down. We undo it once by setting `cam.yScale = -1` after
// createCanvas(). After that, all five camera presets use natural up vectors
// (e.g. +Z for perspective/front/side/listening, +Y for top) with no extra
// scale or sign hacks, and the right-hand rule holds visually in every view.
// See ROADMAP.md discussion item 1.
//
// Text in WEBGL: p5's text() in WEBGL is unreliable, so labels are HTML spans
// positioned each frame via manual view × projection matrix multiplication.
// See ROADMAP.md discussion item 7.

const STATE = {
  metadata: { layoutName: '' },
  audience: { length: 600, width: 800, listeningHeight: 120 },  // cm
  speakers: [
    // Default L/R/C in front of listening centre (toward stage, +Y), aimed
    // at the listening centre (0, 0, listeningHeight=120). Yaw/pitch are
    // aimAtCentre() results rounded to 0.1°.
    { id: 's1', name: 'L', enabled: true, x: -250, y: 150, z: 240, yaw:  121.0, pitch: -22.4, angleH: 90, angleV: 60 },
    { id: 's2', name: 'R', enabled: true, x:  250, y: 150, z: 240, yaw: -121.0, pitch: -22.4, angleH: 90, angleV: 60 },
    { id: 's3', name: 'C', enabled: true, x:    0, y: 200, z: 240, yaw:  180.0, pitch: -31.0, angleH: 70, angleV: 50 },
  ],
  phantoms: [],
  view: {
    unit: 'cm',
    cameraPreset: 'perspective',
    layers: {
      floor: true, audience: true, 'listening-plane': true,
      'listening-centre': true,
      speakers: true, cones: true, axes: true, coords: false,
      'coverage-heat': true, triangulation: false,
      phantoms: true, 'health-panel': true,
    },
  },
};

let _speakerCounter = STATE.speakers.length + 1;
function nextSpeakerId() { return 's' + (_speakerCounter++); }

let _phantomCounter = STATE.phantoms.length + 1;
function nextPhantomId() { return 'p' + (_phantomCounter++); }

// =============================================================================
// State persistence — version, source URL, embedded-state boot loader (M4.B).
// Downloaded HTML files carry a <script id="coverage-state" type="application/json">
// node; on boot, if that node is present and parses cleanly with the right
// schemaVersion, we replace the default STATE before setup() runs.
// =============================================================================

const SCHEMA_VERSION = 1;
const TOOL_VERSION = '1.0.0';
const SOURCE_URL = 'https://tools.zcreation.art/coverage';

// Allowed layer keys — anything outside this whitelist is dropped on load,
// keeping the loader tolerant of unknown fields (forward-compat for v1.1).
const LAYER_KEYS = [
  'floor', 'audience', 'listening-plane', 'listening-centre',
  'speakers', 'cones', 'axes', 'coords',
  'coverage-heat', 'triangulation', 'phantoms', 'health-panel',
];
const CAMERA_PRESETS = ['perspective', 'top', 'front', 'side', 'listening'];

function applyLoadedState(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('state is not an object');
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('schemaVersion mismatch: expected ' + SCHEMA_VERSION + ', got ' + parsed.schemaVersion);
  }

  // Metadata: only layoutName round-trips into the editing UI; the other
  // fields are write-only on save, ignored on load (we'll regenerate them).
  if (parsed.metadata && typeof parsed.metadata.layoutName === 'string') {
    STATE.metadata.layoutName = parsed.metadata.layoutName;
  } else {
    STATE.metadata.layoutName = '';
  }

  // Audience.
  if (parsed.audience && typeof parsed.audience === 'object') {
    for (const k of ['length', 'width', 'listeningHeight']) {
      const v = Number(parsed.audience[k]);
      if (Number.isFinite(v) && v > 0) STATE.audience[k] = v;
    }
  }

  // Speakers.
  if (Array.isArray(parsed.speakers)) {
    STATE.speakers = parsed.speakers
      .filter(s => s && typeof s === 'object')
      .map(s => ({
        id: typeof s.id === 'string' ? s.id : nextSpeakerId(),
        name: typeof s.name === 'string' ? s.name : 'Speaker',
        enabled: s.enabled !== false,
        x: Number(s.x) || 0,
        y: Number(s.y) || 0,
        z: Number(s.z) || 0,
        yaw: Number(s.yaw) || 0,
        pitch: Number(s.pitch) || 0,
        angleH: Number.isFinite(Number(s.angleH)) ? Number(s.angleH) : 90,
        angleV: Number.isFinite(Number(s.angleV)) ? Number(s.angleV) : 60,
      }));
  }

  // Phantoms.
  if (Array.isArray(parsed.phantoms)) {
    STATE.phantoms = parsed.phantoms
      .filter(p => p && typeof p === 'object')
      .map(p => ({
        id: typeof p.id === 'string' ? p.id : nextPhantomId(),
        name: typeof p.name === 'string' ? p.name : 'Phantom',
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        z: Number(p.z) || 0,
      }));
  }

  // View.
  if (parsed.view && typeof parsed.view === 'object') {
    if (parsed.view.unit === 'cm' || parsed.view.unit === 'm') {
      STATE.view.unit = parsed.view.unit;
    }
    if (CAMERA_PRESETS.includes(parsed.view.cameraPreset)) {
      STATE.view.cameraPreset = parsed.view.cameraPreset;
    }
    if (parsed.view.layers && typeof parsed.view.layers === 'object') {
      for (const k of LAYER_KEYS) {
        if (typeof parsed.view.layers[k] === 'boolean') {
          STATE.view.layers[k] = parsed.view.layers[k];
        }
      }
    }
  }

  rebuildIdCounters();
}

function rebuildIdCounters() {
  let maxS = 0, maxP = 0;
  for (const s of STATE.speakers) {
    const m = /^s(\d+)$/.exec(s.id);
    if (m) maxS = Math.max(maxS, parseInt(m[1], 10));
  }
  for (const p of STATE.phantoms) {
    const m = /^p(\d+)$/.exec(p.id);
    if (m) maxP = Math.max(maxP, parseInt(m[1], 10));
  }
  _speakerCounter = maxS + 1;
  _phantomCounter = maxP + 1;
}

// Boot-time embedded-state loader. Runs synchronously at module top level so
// STATE is already up-to-date by the time p5 calls setup() on DOMContentLoaded.
// Failures are non-fatal and logged — UI still boots with the default layout.
(function loadEmbeddedStateOnBoot() {
  const el = typeof document !== 'undefined' && document.getElementById('coverage-state');
  if (!el) return;
  const text = el.textContent || '';
  if (!text.trim()) return;
  try {
    const parsed = JSON.parse(text);
    applyLoadedState(parsed);
  } catch (e) {
    console.warn('Embedded coverage-state failed to load; using defaults.', e);
  }
})();

// =============================================================================
// Unit conversion. Internal storage is always cm; display follows STATE.view.unit.
// =============================================================================

function lenDisplay(cm) {
  return STATE.view.unit === 'm' ? cm / 100 : cm;
}
function lenStore(displayed) {
  return STATE.view.unit === 'm' ? displayed * 100 : displayed;
}

// =============================================================================
// Aim helper: yaw/pitch that point a speaker at (sx, sy, sz) toward the
// imagined listening centre. The listening centre is on the audience listening
// plane: (0, 0, listeningHeight) — NOT the world origin (the floor projection).
// Aiming at z=0 would dip every cone toward the floor, which is wrong for
// audience-ear coverage. Returned values are rounded to 0.1°.
//   yaw  = atan2(-Δx, -Δy)         (0° = +Y, +° toward +X clockwise)
//   pitch = atan2(-Δz, √(Δx²+Δy²))  (0° = horizontal, +° looks up)
// =============================================================================

function aimAtCentre(sx, sy, sz) {
  const tx = 0;
  const ty = 0;
  const tz = STATE.audience.listeningHeight;
  const dx = tx - sx;
  const dy = ty - sy;
  const dz = tz - sz;
  const yaw   = Math.atan2(dx, dy) * 180 / Math.PI;
  const horiz = Math.sqrt(dx * dx + dy * dy);
  const pitch = Math.atan2(dz, horiz) * 180 / Math.PI;
  return {
    yaw:   Math.round(yaw   * 10) / 10,
    pitch: Math.round(pitch * 10) / 10,
  };
}

// =============================================================================
// Camera presets — world-space eye / target / up.
// =============================================================================

const CAMERA_DIST = 1400;

function getCameraPreset(name) {
  const h = STATE.audience.listeningHeight;
  switch (name) {
    case 'top':       return { eye: [0, 0, CAMERA_DIST], target: [0, 0, 0],   up: [0, 1, 0] };
    case 'front':     return { eye: [0, -CAMERA_DIST, 200], target: [0, 0, 200], up: [0, 0, 1] };
    case 'side':      return { eye: [CAMERA_DIST, 0, 200], target: [0, 0, 200], up: [0, 0, 1] };
    case 'listening': return { eye: [0, 0, h], target: [0, CAMERA_DIST, h],   up: [0, 0, 1] };
    case 'perspective':
    default:          return { eye: [700, -900, 750], target: [0, 0, 100],     up: [0, 0, 1] };
  }
}

let cam;

function applyCamera() {
  const p = getCameraPreset(STATE.view.cameraPreset);
  camera(...p.eye, ...p.target, ...p.up);
  // Un-flip p5's projection Y. yScale must be set BEFORE perspective() so the
  // new value is baked into projMatrix.
  if (cam) cam.yScale = -1;
  perspective(PI / 3, width / height, 1, 20000);
}

// =============================================================================
// Speaker forward direction & cone corners (world space).
//   yaw  : 0 = +Y, +yaw rotates toward +X (clockwise looking down +Z).
//   pitch: 0 = horizontal, +pitch tilts toward +Z.
// =============================================================================

function speakerForward(yawDeg, pitchDeg) {
  const y = radians(yawDeg);
  const p = radians(pitchDeg);
  return {
    x: Math.sin(y) * Math.cos(p),
    y: Math.cos(y) * Math.cos(p),
    z: Math.sin(p),
  };
}

// Speaker local basis: forward + right + up, all unit vectors in world space.
// Used to build a rectangular-pyramid cone whose base is FLAT and perpendicular
// to forward. This avoids the trapezoid artifact you get from independently
// offsetting yaw and pitch in spherical coordinates.
function speakerBasis(yawDeg, pitchDeg) {
  const f = speakerForward(yawDeg, pitchDeg);
  // Reference world-up; fall back to +Y if forward is parallel to +Z.
  const wu = (Math.abs(f.z) > 0.999) ? [0, 1, 0] : [0, 0, 1];
  // right = forward × world-up, normalized
  const rx = f.y * wu[2] - f.z * wu[1];
  const ry = f.z * wu[0] - f.x * wu[2];
  const rz = f.x * wu[1] - f.y * wu[0];
  const rmag = Math.sqrt(rx*rx + ry*ry + rz*rz);
  const r = { x: rx / rmag, y: ry / rmag, z: rz / rmag };
  // up = right × forward
  const u = {
    x: r.y * f.z - r.z * f.y,
    y: r.z * f.x - r.x * f.z,
    z: r.x * f.y - r.y * f.x,
  };
  return { f, r, u };
}

// 4 corners of the rectangular cone base in world space.
function coneCorners(s, length) {
  const { f, r, u } = speakerBasis(s.yaw, s.pitch);
  const dh = length * Math.tan(radians(s.angleH / 2));
  const dv = length * Math.tan(radians(s.angleV / 2));
  const cx = s.x + length * f.x;
  const cy = s.y + length * f.y;
  const cz = s.z + length * f.z;
  return [
    [+dh, +dv], [-dh, +dv], [-dh, -dv], [+dh, -dv],
  ].map(([h, v]) => ({
    x: cx + h * r.x + v * u.x,
    y: cy + h * r.y + v * u.y,
    z: cz + h * r.z + v * u.z,
  }));
}

// =============================================================================
// Coverage heatmap (SPEC §7).
//
// Grid-sample the listening plane, count enabled speakers covering each cell
// via the rectangular-pyramid test (§7.2), colour by count (§7.3).
//
// Render path: instead of building a p5.Image and using texture() — which is
// flaky in p5 v1.11 WEBGL with hand-painted pixel buffers (the GPU upload
// silently misses, leaving the quad with whatever fill happened to be
// active) — we bucket cells by colour band during compute and draw 4 batched
// QUADS shapes per frame (one per colour). Lighting is disabled for this
// pass so the colours render at their declared RGB rather than being
// modulated by the directional light.
//
// Recompute is leading-edge throttled to 50ms so dragging an angle/position
// field gives near-real-time feedback without flooding the main loop.
// =============================================================================

const COVERAGE = {
  resX: 80,
  resY: 80,
  counts: null,                      // Uint8Array(resX * resY) — kept for M3 hover lookups
  groupVerts: [[], [], [], []],      // flat (x0,y0,x1,y0,x1,y1,x0,y1) repeated, per colour bucket 0/1/2/3+
  dirty: true,
  scheduled: false,
};

function markCoverageDirty() {
  COVERAGE.dirty = true;
  if (COVERAGE.scheduled) return;
  COVERAGE.scheduled = true;
  setTimeout(() => {
    COVERAGE.scheduled = false;
    if (COVERAGE.dirty) computeCoverage();
  }, 50);
}

function computeCoverage() {
  const lx = STATE.audience.length / 2;
  const ly = STATE.audience.width  / 2;
  const z  = STATE.audience.listeningHeight;
  const nx = COVERAGE.resX;
  const ny = COVERAGE.resY;

  if (!COVERAGE.counts || COVERAGE.counts.length !== nx * ny) {
    COVERAGE.counts = new Uint8Array(nx * ny);
  }

  // Pre-bake speaker bases + half-angle tangents. Flat-property objects so
  // the inner loop touches no nested .x/.y/.z lookups.
  const speakers = [];
  for (const s of STATE.speakers) {
    if (!s.enabled) continue;
    const { f, r, u } = speakerBasis(s.yaw, s.pitch);
    speakers.push({
      x: s.x, y: s.y, z: s.z,
      fx: f.x, fy: f.y, fz: f.z,
      rx: r.x, ry: r.y, rz: r.z,
      ux: u.x, uy: u.y, uz: u.z,
      tanH: Math.tan(radians(s.angleH / 2)),
      tanV: Math.tan(radians(s.angleV / 2)),
    });
  }

  const dx = (2 * lx) / nx;
  const dy = (2 * ly) / ny;

  // Reset colour buckets. Reusing the arrays (length = 0) keeps the JS
  // engine's hidden class instead of reallocating, but recomputes are
  // throttled to 50ms so allocation cost is negligible either way.
  for (let g = 0; g < 4; g++) COVERAGE.groupVerts[g].length = 0;

  for (let iy = 0; iy < ny; iy++) {
    const py = -ly + (iy + 0.5) * dy;
    const y0 = -ly + iy * dy;
    const y1 = y0 + dy;
    for (let ix = 0; ix < nx; ix++) {
      const px = -lx + (ix + 0.5) * dx;
      let count = 0;
      for (const s of speakers) {
        const ddx = px - s.x;
        const ddy = py - s.y;
        const ddz = z  - s.z;
        const fp = ddx * s.fx + ddy * s.fy + ddz * s.fz;
        if (fp <= 0) continue;
        const rp = ddx * s.rx + ddy * s.ry + ddz * s.rz;
        const up = ddx * s.ux + ddy * s.uy + ddz * s.uz;
        // Multiply instead of divide so the comparison stays well-defined
        // when fp is tiny-positive.
        if (Math.abs(rp) <= fp * s.tanH && Math.abs(up) <= fp * s.tanV) {
          count++;
        }
      }
      COVERAGE.counts[iy * nx + ix] = count > 255 ? 255 : count;

      const x0 = -lx + ix * dx;
      const x1 = x0 + dx;
      const bucket = count >= 3 ? 3 : count;
      const arr = COVERAGE.groupVerts[bucket];
      arr.push(x0, y0, x1, y0, x1, y1, x0, y1);
    }
  }

  COVERAGE.dirty = false;
}

// SPEC §7.3 lookup. Alpha is moderate-high — high enough that the four
// bands stay distinguishable after compositing over the listening-plane
// fill and grey background, low enough that the floor grid below remains
// legible through the heatmap ("不蓋掉地面格線"). The companion fix:
// when the heatmap layer is on, drawListeningPlane() skips its blue fill
// so the heatmap colours don't get washed by an extra translucent layer.
function coverageColour(count) {
  switch (count) {
    case 0:  return [225,  70,  70, 175];  // red — uncovered hole
    case 1:  return [240, 200,  70, 175];  // yellow — single coverage
    case 2:  return [180, 210,  90, 175];  // orange-green — double
    default: return [ 80, 180, 100, 175];  // green — 3+ healthy
  }
}

function drawCoverageHeat() {
  // 1cm above the listening plane so we don't z-fight its outline. From the
  // listening camera (eye exactly at z = listeningHeight) the heatmap shows
  // edge-on as expected — sitting just above ear level.
  const z = STATE.audience.listeningHeight + 1;

  push();
  noStroke();
  // Disable lighting for this pass — the directional light would otherwise
  // modulate the heatmap RGB, washing reds toward green-grey under the
  // current directional vector. Re-enable when the pass ends.
  if (typeof noLights === 'function') noLights();

  for (let bucket = 0; bucket < 4; bucket++) {
    const verts = COVERAGE.groupVerts[bucket];
    if (verts.length === 0) continue;
    const [r, g, b, a] = coverageColour(bucket);
    fill(r, g, b, a);
    beginShape(QUADS);
    for (let i = 0; i < verts.length; i += 8) {
      vertex(verts[i],     verts[i + 1], z);
      vertex(verts[i + 2], verts[i + 3], z);
      vertex(verts[i + 4], verts[i + 5], z);
      vertex(verts[i + 6], verts[i + 7], z);
    }
    endShape();
  }
  pop();
}

// =============================================================================
// Triangulation diagnostic (SPEC §8, ROADMAP M3.B-α — detection + 2D fallback).
//
// Classifies the current layout (enabled speakers + all phantoms) by the
// geometry of their direction vectors from the listening centre:
//
//   too-few         < 4 points after dropping any at the centre
//   point-at-centre  a point sits on the listening centre (cannot normalize)
//   collinear        all directions on a single line through origin
//   planar           directions span a 2D plane through origin → 2D ring
//   ok               directions span 3D → spherical hull (M3.B-β, pending)
//
// The classification is cached in TRIANGULATION.result and refreshed lazily
// via markTriangulationDirty(). Status text under the layer toggle reflects
// the current result regardless of whether the layer is on. Drawing happens
// only when the layer is on; for B-α only the 'planar' branch draws (a closed
// polygon connecting points in azimuth order), the 'ok' branch is a no-op
// until the spherical hull arrives in B-β.
//
// Coplanarity test: pick the pair (i, j) with the largest |d_i × d_j| as a
// numerically stable plane-normal candidate (any non-parallel pair gives the
// same plane up to sign if the layout is genuinely coplanar; max magnitude
// minimizes float error). Then check max |d_k · n̂| across all points; below
// PLANAR_EPS rad → planar.
// =============================================================================

const TRIANGULATION = {
  result: null,    // { kind, ... } from analyseTriangulation()
  dirty: true,
  scheduled: false,
};

function markTriangulationDirty() {
  TRIANGULATION.dirty = true;
  // Status text needs to refresh even if the layer is off, so we can't rely
  // on draw to recompute. Schedule a microtask-ish update; coalesces multiple
  // edits in the same tick.
  if (TRIANGULATION.scheduled) return;
  TRIANGULATION.scheduled = true;
  setTimeout(() => {
    TRIANGULATION.scheduled = false;
    ensureTriangulationFresh();
    updateTriangulationStatusDom();
  }, 0);
}

function ensureTriangulationFresh() {
  if (!TRIANGULATION.dirty) return;
  TRIANGULATION.result = analyseTriangulation();
  TRIANGULATION.dirty = false;
  // Hover cache references the previous result's face indices — invalidate
  // so the next mousemove re-reads metrics from the new result.
  if (typeof HOVER !== 'undefined') HOVER.lastTriIdx = -1;
  // If a tooltip is currently visible (e.g. user renamed via keyboard
  // without moving the mouse off the triangle), re-pick at the last
  // known cursor position so the new names appear immediately.
  if (typeof HOVER !== 'undefined' && HOVER.mx >= 0) {
    const triEl = document.getElementById('triangle-tooltip');
    const spkEl = document.getElementById('speaker-tooltip');
    if (triEl && spkEl && (!triEl.hidden || !spkEl.hidden)) {
      updateHoverTooltips(HOVER.mx, HOVER.my,
        typeof _pointerCurrentlyOverPanel !== 'undefined' && _pointerCurrentlyOverPanel);
    }
  }
}

// ---------------------------------------------------------------------------
// Sliver pre-merge & spherical convex hull (M3.B-β).
//
// Pre-merge: speakers with directions within SLIVER_MERGE_EPS of each other
// are considered the same panning slot for triangulation purposes — keeping
// them separate would force the hull to generate near-degenerate sliver
// triangles that M3.C would falsely flag as red. The threshold is set above
// the human auditory just-noticeable difference (~1°–3°) so the merge only
// kicks in when speakers are functionally redundant directionally. See
// ROADMAP M3.B discussion item 3.
//
// Hull: incremental construction. Seed tetrahedron from 4 extreme points
// (farthest sequential search); for each remaining point P, find faces
// "visible from P" (P on the outer side of the face plane), collect horizon
// edges (edges that border exactly one visible face), delete visible faces,
// and create one new face per horizon edge with apex P. Face orientation is
// preserved automatically via the horizon-edge directed-pair rule: if a
// visible face had directed edge (u, v), the new face replacing it is
// (P, u, v) so that the same edge is now in (u, v) direction in a face
// containing P, while its non-visible neighbor still has (v, u). Manifold
// invariant: every undirected edge is shared by exactly 2 faces; total face
// count = 2V − 4 (Euler V − E + F = 2 for sphere triangulation).
// ---------------------------------------------------------------------------

const SLIVER_MERGE_EPS = 0.05;          // rad ≈ 2.9°, above auditory JND
const HULL_DET_EPS     = 1e-7;          // signed-determinant threshold
const HULL_VISIBILITY_EPS = 1e-9;       // dot threshold for face-visibility

// Group input points by union-find on pairwise direction angle. Returns the
// merged-point array (length ≤ input length). Each merged point carries
// its own dir/pos plus a names array and a sourceCount.
function premergeSlivers(points) {
  const N = points.length;
  if (N < 2) {
    return points.map(p => ({ ...p, names: [p.name], sourceCount: 1 }));
  }

  const parent = new Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (i, j) => {
    const ri = find(i), rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };

  const cosT = Math.cos(SLIVER_MERGE_EPS);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const a = points[i].dir, b = points[j].dir;
      const dot = a.x*b.x + a.y*b.y + a.z*b.z;
      if (dot >= cosT) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < N; i++) {
    const r = find(i);
    let bucket = groups.get(r);
    if (!bucket) { bucket = []; groups.set(r, bucket); }
    bucket.push(points[i]);
  }

  const merged = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push({ ...group[0], names: [group[0].name], sourceCount: 1 });
      continue;
    }
    let dx = 0, dy = 0, dz = 0, px = 0, py = 0, pz = 0;
    const names = [];
    for (const p of group) {
      dx += p.dir.x; dy += p.dir.y; dz += p.dir.z;
      px += p.pos.x; py += p.pos.y; pz += p.pos.z;
      names.push(p.name);
    }
    const dmag = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const k = group.length;
    merged.push({
      kind: 'merged',
      name: names.join(' + '),
      names,
      sourceCount: k,
      dir: { x: dx / dmag, y: dy / dmag, z: dz / dmag },
      pos: { x: px / k, y: py / k, z: pz / k },
    });
  }
  return merged;
}

// Make a face with the given vertex order, computing the unit outward normal
// from the cross product. Returns null if the triangle is degenerate.
// Caller is responsible for orientation (the normal direction follows from
// the order of vertices, so the caller chooses the order to get outward).
function makeFaceWithOrder(points, ia, ib, ic) {
  const va = points[ia].dir, vb = points[ib].dir, vc = points[ic].dir;
  const ex = vb.x - va.x, ey = vb.y - va.y, ez = vb.z - va.z;
  const fx = vc.x - va.x, fy = vc.y - va.y, fz = vc.z - va.z;
  let nx = ey * fz - ez * fy;
  let ny = ez * fx - ex * fz;
  let nz = ex * fy - ey * fx;
  const m = Math.sqrt(nx*nx + ny*ny + nz*nz);
  if (m < HULL_DET_EPS) return null;
  return { a: ia, b: ib, c: ic, nx: nx / m, ny: ny / m, nz: nz / m };
}

// 4-stage extreme-point search to find a non-degenerate seed tetrahedron.
// Returns { faces, indices } or null if no spanning tetrahedron exists
// (which means the prior collinear/planar check missed an edge case).
function seedTetrahedron(points) {
  const N = points.length;
  if (N < 4) return null;

  // Stage 1: pick i0 arbitrarily.
  const i0 = 0;
  const v0 = points[i0].dir;

  // Stage 2: i1 = farthest from i0 by angle (= smallest dot).
  let i1 = -1, smallestDot = Infinity;
  for (let i = 0; i < N; i++) {
    if (i === i0) continue;
    const v = points[i].dir;
    const d = v0.x*v.x + v0.y*v.y + v0.z*v.z;
    if (d < smallestDot) { smallestDot = d; i1 = i; }
  }
  if (i1 < 0) return null;
  const v1 = points[i1].dir;

  // Stage 3: i2 maximizes |(v1−v0) × (v_i−v0)| (distance from line v0v1).
  const ax = v1.x - v0.x, ay = v1.y - v0.y, az = v1.z - v0.z;
  let i2 = -1, biggestCrossSq = 0;
  for (let i = 0; i < N; i++) {
    if (i === i0 || i === i1) continue;
    const v = points[i].dir;
    const bx = v.x - v0.x, by = v.y - v0.y, bz = v.z - v0.z;
    const cx = ay*bz - az*by, cy = az*bx - ax*bz, cz = ax*by - ay*bx;
    const m2 = cx*cx + cy*cy + cz*cz;
    if (m2 > biggestCrossSq) { biggestCrossSq = m2; i2 = i; }
  }
  if (i2 < 0 || biggestCrossSq < HULL_DET_EPS * HULL_DET_EPS) return null;
  const v2 = points[i2].dir;

  // Stage 4: i3 maximizes |det| of [v1−v0, v2−v0, v−v0] (distance from plane).
  const planeNx = ay * (v2.z - v0.z) - az * (v2.y - v0.y);
  const planeNy = az * (v2.x - v0.x) - ax * (v2.z - v0.z);
  const planeNz = ax * (v2.y - v0.y) - ay * (v2.x - v0.x);
  let i3 = -1, biggestDet = 0;
  for (let i = 0; i < N; i++) {
    if (i === i0 || i === i1 || i === i2) continue;
    const v = points[i].dir;
    const det = planeNx * (v.x - v0.x) + planeNy * (v.y - v0.y) + planeNz * (v.z - v0.z);
    if (Math.abs(det) > Math.abs(biggestDet)) { biggestDet = det; i3 = i; }
  }
  if (i3 < 0 || Math.abs(biggestDet) < HULL_DET_EPS) return null;

  // Build 4 outward-oriented faces. For each face, the opposite vertex is
  // "inside" (the tetrahedron contains it on its interior side); flip vertex
  // order if the computed normal points toward (instead of away from) it.
  const indices = [i0, i1, i2, i3];
  const triples = [[1, 2, 3, 0], [0, 3, 2, 1], [0, 1, 3, 2], [0, 2, 1, 3]];
  const faces = [];
  for (const [a, b, c, opp] of triples) {
    const ia = indices[a], ib = indices[b], ic = indices[c], iOpp = indices[opp];
    let f = makeFaceWithOrder(points, ia, ib, ic);
    if (!f) return null;
    const va = points[ia].dir, vo = points[iOpp].dir;
    const facingOpposite = f.nx * (vo.x - va.x) + f.ny * (vo.y - va.y) + f.nz * (vo.z - va.z);
    if (facingOpposite > 0) {
      // Normal points toward the opposite vertex → flip so it points away.
      f = makeFaceWithOrder(points, ia, ic, ib);
      if (!f) return null;
    }
    faces.push(f);
  }
  return { faces, indices };
}

// Insert one point into the existing hull. Returns the updated face array
// (or the same reference if the point is inside / on the hull, hence
// non-extending).
function insertPointIntoHull(points, faces, pointIdx) {
  const P = points[pointIdx].dir;

  const visible = [];
  const kept = [];
  for (const f of faces) {
    const va = points[f.a].dir;
    const dot = f.nx * (P.x - va.x) + f.ny * (P.y - va.y) + f.nz * (P.z - va.z);
    if (dot > HULL_VISIBILITY_EPS) visible.push(f);
    else kept.push(f);
  }
  if (visible.length === 0) return faces;  // P is inside / on the hull

  // Collect directed edges from visible faces; an edge is on the horizon iff
  // its REVERSE does not also appear in a visible face (i.e., it borders a
  // non-visible face on the other side).
  const visibleEdges = new Map();  // 'u_v' → [u, v]
  for (const f of visible) {
    for (const [u, v] of [[f.a, f.b], [f.b, f.c], [f.c, f.a]]) {
      visibleEdges.set(u + '_' + v, [u, v]);
    }
  }
  const horizon = [];
  for (const [k, [u, v]] of visibleEdges) {
    if (!visibleEdges.has(v + '_' + u)) horizon.push([u, v]);
  }

  // Build new faces: for each horizon edge (u, v) (in the visible face's CCW
  // direction), the new face is (P, u, v) — preserves orientation against
  // the still-present non-visible neighbor that has (v, u).
  for (const [u, v] of horizon) {
    const f = makeFaceWithOrder(points, pointIdx, u, v);
    if (f) kept.push(f);
  }
  return kept;
}

// Orchestrator: seed + iteratively insert. Returns { faces, indices } or
// null on failure (which the caller treats as a numerical fallback).
function buildSphericalHull(points) {
  const seed = seedTetrahedron(points);
  if (!seed) return null;
  let faces = seed.faces;
  const used = new Set(seed.indices);
  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    faces = insertPointIntoHull(points, faces, i);
  }
  return { faces };
}

// ---------------------------------------------------------------------------
// Per-triangle metrics (M3.C) — spherical area via L'Huilier theorem and
// max interior angle via spherical law of cosines. Both inputs are unit
// vectors on the sphere. Returned units: steradians (radians²) for area,
// radians for max angle. Caller is responsible for converting to the
// classification per SPEC §8.2 (area ratio vs median, angle thresholds).
// ---------------------------------------------------------------------------

const SPHERICAL_SIDE_EPS = 1e-9;  // arc-length below this → degenerate

function clamp1(x) { return x < -1 ? -1 : x > 1 ? 1 : x; }
function arcLen(u, v) { return Math.acos(clamp1(u.x*v.x + u.y*v.y + u.z*v.z)); }

function sphericalTriangleArea(A, B, C) {
  const a = arcLen(B, C);
  const b = arcLen(C, A);
  const c = arcLen(A, B);
  // Degenerate (one side ≈ 0): area is 0 by definition.
  if (a < SPHERICAL_SIDE_EPS || b < SPHERICAL_SIDE_EPS || c < SPHERICAL_SIDE_EPS) return 0;
  const s = (a + b + c) / 2;
  // Float-safety: tan products can go slightly negative near degenerate.
  const t = Math.tan(s/2)
          * Math.tan((s-a)/2)
          * Math.tan((s-b)/2)
          * Math.tan((s-c)/2);
  return 4 * Math.atan(Math.sqrt(Math.max(0, t)));
}

function sphericalTriangleMaxAngle(A, B, C) {
  const a = arcLen(B, C);
  const b = arcLen(C, A);
  const c = arcLen(A, B);
  // Degenerate side → return π so the triangle trips the red threshold.
  if (a < SPHERICAL_SIDE_EPS || b < SPHERICAL_SIDE_EPS || c < SPHERICAL_SIDE_EPS) return Math.PI;
  // Spherical law of cosines: angle at A (opposite side a) =
  //   acos((cos a − cos b cos c) / (sin b sin c))
  const angleAt = (oppositeSide, adj1, adj2) => {
    const sinProd = Math.sin(adj1) * Math.sin(adj2);
    if (sinProd < SPHERICAL_SIDE_EPS) return Math.PI;
    return Math.acos(clamp1(
      (Math.cos(oppositeSide) - Math.cos(adj1) * Math.cos(adj2)) / sinProd
    ));
  };
  return Math.max(
    angleAt(a, b, c),
    angleAt(b, c, a),
    angleAt(c, a, b),
  );
}

// Median of a numeric array. Returns 0 for empty input. Uses (lo+hi)/2 for
// even counts. Operates on a copy so the caller's order is preserved.
function median(values) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// SPEC §8.2 classification thresholds. Hardcoded for v1.
// Angle thresholds anchored to regular polyhedra on the unit sphere:
// icosahedron face vertex angle = 72° (12 points; the most equilateral
// VBAP-friendly low-point sphere), octahedron = 90° (6 points; borderline
// usable as 6-channel surround), tetrahedron = 120° (4 points; clearly
// degenerate). YELLOW set above icosahedron so a perfectly icosahedral
// layout reads green; RED set past octahedron with implementation cushion
// so 90.0/89.9 borderline doesn't flip on every edit.
const HEALTH_ANGLE_YELLOW = 75 * Math.PI / 180;  //  > 75° → yellow
const HEALTH_ANGLE_RED    = 105 * Math.PI / 180; //  > 105° → red
// Area ratio thresholds remain subjective ("uneven layout") and stay in
// the M5 calibration backlog for beta + workshop tuning.
const HEALTH_RATIO_YELLOW = 1.5;                 //  > 1.5× median → yellow
const HEALTH_RATIO_RED    = 2.5;                 //  > 2.5× median → red

function classifyTriangle(area, maxAngle, areaRatio) {
  // Worst-of across both metrics. Order matters: red can't be downgraded.
  let level = 'green';
  if (maxAngle > HEALTH_ANGLE_RED)         level = 'red';
  else if (maxAngle > HEALTH_ANGLE_YELLOW) level = 'yellow';
  if (areaRatio > HEALTH_RATIO_RED)         level = 'red';
  else if (areaRatio > HEALTH_RATIO_YELLOW && level !== 'red') level = 'yellow';
  return level;
}

function computeHullMetrics(points, faces) {
  const N = faces.length;
  const areas = new Array(N);
  const maxAngles = new Array(N);
  const regions = new Array(N);
  for (let i = 0; i < N; i++) {
    const f = faces[i];
    const A = points[f.a].dir, B = points[f.b].dir, C = points[f.c].dir;
    areas[i] = sphericalTriangleArea(A, B, C);
    maxAngles[i] = sphericalTriangleMaxAngle(A, B, C);
    regions[i] = faceRegion(A, B, C);
  }
  const medianArea = median(areas);
  const metrics = new Array(N);
  const summary = { green: 0, yellow: 0, red: 0 };
  for (let i = 0; i < N; i++) {
    const ratio = medianArea > 0 ? areas[i] / medianArea : 1;
    const level = classifyTriangle(areas[i], maxAngles[i], ratio);
    metrics[i] = {
      area: areas[i],
      maxAngle: maxAngles[i],
      areaRatio: ratio,
      level,
      region: regions[i],
    };
    summary[level]++;
  }
  return { metrics, medianArea, summary };
}

// ---------------------------------------------------------------------------
// Region labels (SPEC §8.3) — coarse direction tag for a triangle's
// centroid. Maps a unit-vector direction to one of the 8 fixed labels:
//   upper hemisphere / lower hemisphere / front / rear /
//   right side / left side / centerline / surround ring
//
// Decision tree:
//  1. |z| > 0.7              → upper / lower hemisphere (strong vertical)
//  2. |y| > 0.7              → front / rear              (strong forward/back)
//  3. |x| > 0.7              → right / left side         (strong horizontal)
//  4. |x| < 0.3              → centerline                (no x dominance)
//  5. |z| < 0.3              → surround ring             (mostly horizontal)
//  6. otherwise              → 'the surround region'     (no clean label)
//
// dominantRegion picks the most-common label across triangles matching the
// requested level. Ties broken by first occurrence (Map preserves insertion
// order). Used by composeHealthLines to fill the [region] slot of the
// dynamic warning text.
// ---------------------------------------------------------------------------

function regionForCentroid(c) {
  if (c.z >  0.7) return 'upper hemisphere';
  if (c.z < -0.7) return 'lower hemisphere';
  if (c.y >  0.7) return 'front';
  if (c.y < -0.7) return 'rear';
  if (c.x >  0.7) return 'right side';
  if (c.x < -0.7) return 'left side';
  if (Math.abs(c.x) < 0.3) return 'centerline';
  if (Math.abs(c.z) < 0.3) return 'surround ring';
  return 'the surround region';
}

function faceRegion(A, B, C) {
  const cx = (A.x + B.x + C.x) / 3;
  const cy = (A.y + B.y + C.y) / 3;
  const cz = (A.z + B.z + C.z) / 3;
  const m = Math.sqrt(cx*cx + cy*cy + cz*cz);
  if (m < 1e-12) return 'the surround region';  // degenerate, shouldn't happen
  return regionForCentroid({ x: cx / m, y: cy / m, z: cz / m });
}

function dominantRegion(metrics, level) {
  const counts = new Map();
  for (const m of metrics) {
    if (m.level !== level) continue;
    counts.set(m.region, (counts.get(m.region) || 0) + 1);
  }
  let bestRegion = 'the layout';
  let bestCount = 0;
  for (const [region, count] of counts) {
    if (count > bestCount) { bestCount = count; bestRegion = region; }
  }
  return bestRegion;
}

// ---------------------------------------------------------------------------
// L/R symmetry deviation (M3.D). For each merged point's direction, find
// the nearest direction in the X-mirrored set; return the mean angular
// distance (radians). 0 → perfectly mirror-symmetric across the listening
// centerline (X=0 plane). Larger → asymmetric.
//
// Greedy nearest-neighbour pairing (each original maps to its closest
// mirror) rather than bipartite minimum matching. Hungarian-style matching
// would be more rigorous but materially differs only on pathological
// inputs (clustered duplicates pulling toward the same mirror); for
// typical speaker layouts (N ≤ 32 distinct directions) greedy is correct
// and ~10× cheaper. Acceptable trade for v1.
//
// Thresholds per SPEC §8.2 (v1 estimate; ROADMAP discussion item 2 to
// recalibrate before launch with real layouts):
//   > 0.05 rad → yellow
//   > 0.15 rad → red
// ---------------------------------------------------------------------------

const SYMMETRY_DELTA_YELLOW = 0.05;
const SYMMETRY_DELTA_RED    = 0.15;

function computeSymmetryDelta(points) {
  const N = points.length;
  if (N === 0) return null;
  let total = 0;
  for (const p of points) {
    let minAngle = Infinity;
    const px = p.dir.x, py = p.dir.y, pz = p.dir.z;
    for (const q of points) {
      // mirror(q).dir = (-q.dir.x, q.dir.y, q.dir.z); dot with p =
      // -px*qx + py*qy + pz*qz. Pure inline — no allocation.
      const dot = -px * q.dir.x + py * q.dir.y + pz * q.dir.z;
      const angle = Math.acos(clamp1(dot));
      if (angle < minAngle) minAngle = angle;
    }
    total += minAngle;
  }
  return total / N;
}

function classifySymmetry(delta) {
  if (delta == null) return null;
  if (delta > SYMMETRY_DELTA_RED)    return 'red';
  if (delta > SYMMETRY_DELTA_YELLOW) return 'yellow';
  return 'green';
}

// Diagnostic-only manifold check used by the dev tests. Throws on violation.
// Conditions: every directed edge appears exactly once; its reverse exists
// (= each undirected edge shared by exactly 2 faces); Euler V − E + F = 2.
function assertManifoldOrThrow(faces) {
  const edgeCount = new Map();
  for (const f of faces) {
    for (const [u, v] of [[f.a, f.b], [f.b, f.c], [f.c, f.a]]) {
      const k = u + '_' + v;
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    }
  }
  for (const [k, count] of edgeCount) {
    if (count !== 1) throw new Error(`directed edge ${k} appears ${count}× (expected 1)`);
  }
  for (const k of edgeCount.keys()) {
    const [u, v] = k.split('_');
    if (!edgeCount.has(v + '_' + u)) throw new Error(`directed edge ${k} has no reverse — not a manifold`);
  }
  const verts = new Set();
  for (const f of faces) { verts.add(f.a); verts.add(f.b); verts.add(f.c); }
  const V = verts.size;
  const E = edgeCount.size / 2;
  const F = faces.length;
  if (V - E + F !== 2) throw new Error(`Euler check failed: V=${V}, E=${E}, F=${F}, χ=${V-E+F}`);
}

function analyseTriangulation() {
  // Listening centre is the panning origin; all directions are measured from
  // here, NOT from the world floor origin.
  const ox = 0, oy = 0, oz = STATE.audience.listeningHeight;

  // 1 cm: closer than this and the direction vector is numerically unusable.
  // The user-visible message names the offending point so they can fix it.
  const POINT_AT_CENTRE_EPS = 1.0;

  // Threshold below which a candidate plane normal is considered too short
  // to be meaningful (i.e. the two source directions are nearly parallel).
  // |d_i × d_j| = sin(angle), so 1e-3 ≈ 0.057° between the pair.
  const COLLINEAR_EPS = 1e-3;

  // Below this a point is considered to lie on the candidate plane. The
  // value is sin(angle to plane); 1e-3 rad ≈ 0.057° tolerance, tight enough
  // that a 3D dome won't be misread as planar but loose enough to absorb
  // typical speaker-coordinate rounding.
  const PLANAR_EPS = 1e-3;

  const points = [];
  // Collect every point sitting on the listening centre, not just the first —
  // listing them all lets the user fix the layout in one pass instead of
  // playing whack-a-mole. The names array is what the status text consumes.
  const atCentre = [];

  function consume(item, kind) {
    const dx = item.x - ox;
    const dy = item.y - oy;
    const dz = item.z - oz;
    const mag = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (mag < POINT_AT_CENTRE_EPS) {
      atCentre.push(item.name || '(unnamed)');
      return;
    }
    points.push({
      kind,
      name: item.name || '(unnamed)',
      pos: { x: item.x, y: item.y, z: item.z },
      dir: { x: dx / mag, y: dy / mag, z: dz / mag },
    });
  }

  for (const s of STATE.speakers) {
    if (!s.enabled) continue;
    consume(s, 'speaker');
  }
  for (const p of STATE.phantoms) {
    consume(p, 'phantom');
  }

  if (atCentre.length > 0) {
    return { kind: 'point-at-centre', names: atCentre };
  }

  // Sliver pre-merge — collapse direction-near-duplicate inputs so the hull
  // doesn't generate sliver triangles that M3.C would falsely flag as red.
  // The merged-points array is what every downstream branch operates on.
  const inputCount = points.length;
  const merged = premergeSlivers(points);
  const mergeReduction = inputCount - merged.length;

  // L/R symmetry — layout-wide property, computed once and attached to
  // every post-merge return so the caption can warn about asymmetric
  // layouts even when triangulation isn't possible (too-few / collinear).
  const symmetryDelta = computeSymmetryDelta(merged);
  const symmetry = symmetryDelta == null
    ? null
    : { delta: symmetryDelta, level: classifySymmetry(symmetryDelta) };

  if (merged.length < 4) {
    return {
      kind: 'too-few',
      count: merged.length,
      inputCount, mergeReduction, symmetry,
    };
  }

  // Plane-normal candidate via the most numerically stable triple. We use
  // EDGE crosses (b−a)×(c−a) rather than vertex crosses a×b — vertex crosses
  // only detect planes through origin (great circles). Edge crosses also
  // catch affine-coplanar inputs (small circles of latitude), e.g. four
  // overhead cabinets at constant z=180cm aimed down at a seated listener
  // — same panning topology as a horizontal ring, just shifted off origin.
  // O(N³) on N≤32 = trivial.
  let nx = 0, ny = 0, nz = 0, bestMag = 0;
  for (let i = 0; i < merged.length; i++) {
    const a = merged[i].dir;
    for (let j = i + 1; j < merged.length; j++) {
      const b = merged[j].dir;
      const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
      for (let k = j + 1; k < merged.length; k++) {
        const c = merged[k].dir;
        const fx = c.x - a.x, fy = c.y - a.y, fz = c.z - a.z;
        const cx = ey * fz - ez * fy;
        const cy = ez * fx - ex * fz;
        const cz = ex * fy - ey * fx;
        const m2 = cx*cx + cy*cy + cz*cz;
        if (m2 > bestMag * bestMag) {
          bestMag = Math.sqrt(m2);
          nx = cx / bestMag;
          ny = cy / bestMag;
          nz = cz / bestMag;
        }
      }
    }
  }

  if (bestMag < COLLINEAR_EPS) {
    return {
      kind: 'collinear',
      count: merged.length,
      inputCount, mergeReduction, symmetry,
    };
  }

  // Reference projection — any merged point's projection onto n. Affine-
  // coplanar means all projections share this value; |proj - d0| < eps tests
  // both small (d0 ≠ 0) and great circles (d0 ≈ 0) in one branch.
  const d0 = merged[0].dir.x * nx + merged[0].dir.y * ny + merged[0].dir.z * nz;
  let maxDeviation = 0;
  for (const p of merged) {
    const proj = p.dir.x * nx + p.dir.y * ny + p.dir.z * nz;
    const dev = Math.abs(proj - d0);
    if (dev > maxDeviation) maxDeviation = dev;
  }

  if (maxDeviation < PLANAR_EPS) {
    // Tangent basis for azimuth sort. Subtract V0's normal component so u
    // lies in the plane regardless of d0; for great circles (d0 ≈ 0) this
    // reduces to V0 itself.
    const u0 = merged[0].dir;
    let ux = u0.x - d0 * nx;
    let uy = u0.y - d0 * ny;
    let uz = u0.z - d0 * nz;
    const umag = Math.sqrt(ux*ux + uy*uy + uz*uz);
    ux /= umag; uy /= umag; uz /= umag;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const azimuth = (d) => Math.atan2(
      d.x * vx + d.y * vy + d.z * vz,
      d.x * ux + d.y * uy + d.z * uz,
    );
    const sorted = merged.slice().sort((p, q) => azimuth(p.dir) - azimuth(q.dir));
    return {
      kind: 'planar',
      points: sorted,
      normal: { x: nx, y: ny, z: nz },
      inputCount, mergeReduction, symmetry,
    };
  }

  // 3D — build the spherical convex hull.
  const hull = buildSphericalHull(merged);
  if (!hull) {
    // Hull-open: directions span 3D from origin (we passed the planar
    // check) but happen to lie in a single AFFINE plane that doesn't
    // contain origin. seedTetrahedron's 4th-stage |det| test correctly
    // rejects this — geometrically, the convex hull is a 2D patch on the
    // sphere, not a closed surface around the listening centre. The
    // canonical fix per SPEC §8.4 is to add a phantom above or below the
    // layout (zenith / nadir) so the directions span 3D affinely too,
    // letting the hull close. Common trigger: 4+ speakers all at the
    // same height around an audience, with the listening centre below.
    return {
      kind: 'hull-open',
      count: merged.length,
      inputCount, mergeReduction, symmetry,
    };
  }
  const { metrics, medianArea, summary } = computeHullMetrics(merged, hull.faces);
  return {
    kind: 'ok',
    points: merged,
    faces: hull.faces,
    metrics,
    medianArea,
    healthSummary: summary,
    inputCount, mergeReduction, symmetry,
  };
}

// Suffix appended to status text when the sliver pre-merge collapsed inputs.
// Empty string when no merge happened, otherwise " (N sliver-merged)".
function mergeNote(r) {
  return r.mergeReduction > 0 ? ` (${r.mergeReduction} sliver-merged)` : '';
}

// Caption under the triangulation layer toggle is intentionally minimal:
// it answers "what kind of layout is this and how many points / triangles"
// — the Layout Health panel (M3.E) carries the health and symmetry warnings
// that used to live here as suffixes. Keeping mergeNote because it's a
// non-health input-vs-effective-count fact the panel doesn't surface.
function triangulationStatusText(r) {
  if (!r) return '';
  switch (r.kind) {
    case 'too-few':
      return `Add ≥ 4 enabled speakers or phantoms to enable triangulation. Currently: ${r.count}${mergeNote(r)}.`;
    case 'point-at-centre': {
      // 1 → "X sits", 2 → "X and Y sit", 3-4 → "X, Y, and Z sit",
      // 5+ → first three names + "...and N more sit". Cap is to keep the
      // caption readable; if the user really has 5+ points at the centre
      // they have bigger problems anyway.
      const quoted = r.names.map(n => `“${n}”`);
      const verb = quoted.length === 1 ? 'sits' : 'sit';
      let head;
      if (quoted.length === 1) {
        head = quoted[0];
      } else if (quoted.length === 2) {
        head = `${quoted[0]} and ${quoted[1]}`;
      } else if (quoted.length <= 4) {
        head = `${quoted.slice(0, -1).join(', ')}, and ${quoted[quoted.length - 1]}`;
      } else {
        head = `${quoted.slice(0, 3).join(', ')}, and ${quoted.length - 3} more`;
      }
      return `${head} ${verb} on the listening centre — cannot triangulate.`;
    }
    case 'collinear':
      return `Speakers are collinear from the listening centre — layout needs spatial spread${mergeNote(r)}.`;
    case 'hull-open':
      return `Open hull — ${r.count} points don't enclose the listening centre${mergeNote(r)}.`;
    case 'planar':
      // Note: mergeNote moved outside the parens (was nested inside before
      // M3.D, which produced awkward "(4 points (1 sliver-merged))"). The
      // new form is "(4 points) (1 sliver-merged)" — fewer nested parens.
      return `Planar layout — 2D ring shown in place of triangulation (${r.points.length} points)${mergeNote(r)}.`;
    case 'ok':
      // Health summary + symmetry now live in the Layout Health panel.
      return `3D layout — ${r.points.length} points → ${r.faces.length} triangles${mergeNote(r)}.`;
    default:
      return '';
  }
}

function updateTriangulationStatusDom() {
  const el = document.getElementById('triangulation-status');
  if (!el) return;
  const text = triangulationStatusText(TRIANGULATION.result);
  el.textContent = text;
  // Tag the row by kind so CSS can colour-code (red / yellow / green) in M3.E.
  const row = el.closest('.triangulation-status');
  if (row) row.dataset.kind = TRIANGULATION.result ? TRIANGULATION.result.kind : '';
  // Layout Health panel mirrors the same result through a richer surface.
  updateHealthPanelDom();
}

// ---------------------------------------------------------------------------
// Layout Health panel (M3.E, SPEC §8.3). Produces a list of {text, level}
// lines from the analyseTriangulation result, where level ∈ {ok, info,
// warn, fail} drives the icon and colour. The panel framing paragraph is
// static markup in index.html — these lines fill the dynamic status block.
//
// Lines emitted:
//   1. A primary line summarising the layout kind:
//      - ok 'green'            → ✓ Layout looks healthy.
//      - ok 'yellow'           → ⚠ N suspect triangle(s) detected in <region>. Coverage may degrade.
//      - ok 'red'              → ✗ N problematic triangle(s) detected in <region>. Consider adding phantom speaker(s).
//      - planar                → ℹ Planar layout — 2D ring shown in place of triangulation.
//      - too-few               → ⚠ Add ≥ 4 enabled speakers or phantoms — only N reachable.
//      - collinear             → ⚠ Speakers are collinear from the listening centre — layout needs spatial spread.
//      - point-at-centre       → ✗ N point(s) sit on the listening centre — cannot triangulate.
//   2. (independent) Symmetry warning when level is yellow / red:
//      - ⚠ Layout is asymmetric (L/R, Δ = X.XX rad). Sources panning across the centerline may behave inconsistently.
// ---------------------------------------------------------------------------

function pluralize(n, singular, plural) {
  return n === 1 ? singular : (plural || singular + 's');
}

function composeHealthLines(r) {
  if (!r) return [];
  const lines = [];

  switch (r.kind) {
    case 'too-few':
      lines.push({
        level: 'warn',
        text: `⚠ Add ≥ 4 enabled speakers or phantoms — only ${r.count} reachable.`,
      });
      break;
    case 'point-at-centre': {
      const n = r.names.length;
      const verb = pluralize(n, 'sits', 'sit');
      const noun = pluralize(n, 'point', 'points');
      lines.push({
        level: 'fail',
        text: `✗ ${n} ${noun} ${verb} on the listening centre — cannot triangulate.`,
      });
      break;
    }
    case 'collinear':
      lines.push({
        level: 'warn',
        text: '⚠ Speakers are collinear from the listening centre — layout needs spatial spread.',
      });
      break;
    case 'hull-open':
      lines.push({
        level: 'warn',
        text: '⚠ Layout doesn\'t enclose the listening centre — add a phantom above or below to close the panning grid.',
      });
      break;
    case 'planar':
      lines.push({
        level: 'info',
        text: 'ℹ Planar layout — 2D ring shown in place of triangulation.',
      });
      break;
    case 'ok': {
      const s = r.healthSummary;
      if (s.red > 0) {
        const region = dominantRegion(r.metrics, 'red');
        const noun = pluralize(s.red, 'triangle');
        lines.push({
          level: 'fail',
          text: `✗ ${s.red} problematic ${noun} detected in ${region}. Consider adding phantom speaker(s).`,
        });
      } else if (s.yellow > 0) {
        const region = dominantRegion(r.metrics, 'yellow');
        const noun = pluralize(s.yellow, 'triangle');
        lines.push({
          level: 'warn',
          text: `⚠ ${s.yellow} suspect ${noun} detected in ${region}. Coverage may degrade.`,
        });
      } else {
        lines.push({ level: 'ok', text: '✓ Layout looks healthy.' });
      }
      break;
    }
  }

  // Symmetry — independent line, only on yellow / red. SPEC §8.3 uses ⚠
  // for both levels (the magnitude is conveyed by the Δ value, not the icon).
  if (r.symmetry && (r.symmetry.level === 'yellow' || r.symmetry.level === 'red')) {
    lines.push({
      level: r.symmetry.level === 'red' ? 'fail' : 'warn',
      text: `⚠ Layout is asymmetric (L/R, Δ = ${r.symmetry.delta.toFixed(2)} rad). Sources panning across the centerline may behave inconsistently.`,
    });
  }

  return lines;
}

function updateHealthPanelDom() {
  const host = document.getElementById('health-panel-status');
  if (!host) return;
  const lines = composeHealthLines(TRIANGULATION.result);
  // Rebuild the status block from scratch — line count varies (0 / 1 / 2)
  // and content is short, so DOM diffing buys nothing.
  host.innerHTML = '';
  for (const { text, level } of lines) {
    const p = document.createElement('p');
    p.className = 'health-line health-line-' + level;
    p.textContent = text;
    host.appendChild(p);
  }
}

// Stroke colour per health level. Aligns with SPEC §14's emoji-colour rule
// (✓ green / ⚠ yellow / ✗ red). Alpha tuned to read clearly above the
// heatmap without overwhelming it; matches the 2D-ring purple's alpha.
const LEVEL_STROKE = {
  green:  [ 80, 180, 100, 220],
  yellow: [240, 200,  70, 220],
  red:    [225,  70,  70, 220],
};

function drawTriangulation() {
  const r = TRIANGULATION.result;
  if (!r) return;
  // Caller (drawScene) already disabled DEPTH_TEST for this pass.
  push();
  noFill();
  // Triangulation is a user-activated diagnostic — sits above cone wires
  // (1.0–1.2) and floor grid (1.0), below axes (2.0). 1.8 keeps health
  // colours legible at typical zoom without dwarfing the geometry.
  strokeWeight(1.8);

  if (r.kind === 'planar') {
    // Planar layout has no per-triangle metrics, so use the original
    // structural-overlay purple to signal "this is a 2D ring, not a hull".
    stroke(95, 70, 145, 220);
    beginShape();
    for (const p of r.points) vertex(p.pos.x, p.pos.y, p.pos.z);
    endShape(CLOSE);
  } else if (r.kind === 'ok') {
    // Each undirected edge is shared by two faces; we paint per-face, so
    // shared edges get painted twice. When neighbours have different levels
    // (e.g. one yellow / one red), the second draw wins for that edge —
    // visually the user sees a mix of both colours in the area, which is
    // the right read since "this region has a problematic neighbourhood".
    for (let i = 0; i < r.faces.length; i++) {
      const f = r.faces[i];
      const [cr, cg, cb, ca] = LEVEL_STROKE[r.metrics[i].level];
      stroke(cr, cg, cb, ca);
      const a = r.points[f.a].pos;
      const b = r.points[f.b].pos;
      const c = r.points[f.c].pos;
      beginShape();
      vertex(a.x, a.y, a.z);
      vertex(b.x, b.y, b.z);
      vertex(c.x, c.y, c.z);
      endShape(CLOSE);
    }
  }
  pop();
}

// ---------------------------------------------------------------------------
// Hover tooltips (M3.F triangle, M3.G speaker).
//
// Two tooltips share a picking framework: speaker takes priority over
// triangle when both would hit (speakers are foreground markers; user
// usually wants speaker info if their cursor is on one). Each tooltip is
// a separate DOM element; the unified updateHoverTooltips handler decides
// which to show and which to hide based on pickSpeaker / pickTriangle.
//
// Triangle picking: project each hull face's three world-space vertices
// to canvas pixels via projectToScreen, run point-in-triangle, depth-
// tiebreak by world-space distance from camera eye to face centroid.
//
// Speaker picking: project each enabled speaker's position; hit if mouse
// is within SPEAKER_PICK_PX pixels of the projected center; depth-tiebreak
// by world-space distance to eye.
//
// Hide gates (apply to both): triangulation/speakers layer off (per
// tooltip), pointer over a panel, orbit drag in progress, no hit.
//
// HOVER state: { speakerId, lastTriIdx } — speakerId drives the 3D
// highlight in drawSpeakerBody; lastTriIdx is a write-skip cache so
// same-triangle moves only reposition without rewriting text.
// ---------------------------------------------------------------------------

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  // Sign of the 2D cross products (px-bx, py-by) × (ax-bx, ay-by) for each
  // edge. If all signs agree, point is inside (with edges treated as inside
  // when the cross product is exactly 0).
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(hasNeg && hasPos);
}

function pickTriangle(mx, my) {
  const r = TRIANGULATION.result;
  if (!r || r.kind !== 'ok') return -1;
  if (!STATE.view.layers.triangulation) return -1;
  if (!cam) return -1;

  let bestIdx = -1;
  let bestDepthSq = Infinity;
  const ex = cam.eyeX, ey = cam.eyeY, ez = cam.eyeZ;

  for (let i = 0; i < r.faces.length; i++) {
    const f = r.faces[i];
    const pa = r.points[f.a].pos;
    const pb = r.points[f.b].pos;
    const pc = r.points[f.c].pos;
    const sa = projectToScreen(pa.x, pa.y, pa.z);
    const sb = projectToScreen(pb.x, pb.y, pb.z);
    const sc = projectToScreen(pc.x, pc.y, pc.z);
    if (!sa || !sb || !sc) continue;
    if (sa.behind || sb.behind || sc.behind) continue;
    if (!pointInTriangle(mx, my, sa.sx, sa.sy, sb.sx, sb.sy, sc.sx, sc.sy)) continue;

    // Depth tiebreak: distance from camera eye to face centroid (squared,
    // since we only compare).
    const cx = (pa.x + pb.x + pc.x) / 3;
    const cy = (pa.y + pb.y + pc.y) / 3;
    const cz = (pa.z + pb.z + pc.z) / 3;
    const dx = cx - ex, dy = cy - ey, dz = cz - ez;
    const d2 = dx*dx + dy*dy + dz*dz;
    if (d2 < bestDepthSq) { bestDepthSq = d2; bestIdx = i; }
  }
  return bestIdx;
}

// Pixel-radius tolerance for speaker hits. Speaker bodies are drawn as
// sphere(26) in world units; the projected screen radius varies with
// camera distance, but for typical orbit zooms a fixed 28-px tolerance
// covers the marker generously without overlapping neighbours at common
// 5.1 / 7.1 spacings.
const SPEAKER_PICK_PX = 28;

function pickSpeaker(mx, my) {
  if (!cam) return null;
  if (!STATE.view.layers.speakers) return null;

  let best = null;
  let bestDepthSq = Infinity;
  const ex = cam.eyeX, ey = cam.eyeY, ez = cam.eyeZ;
  const tolSq = SPEAKER_PICK_PX * SPEAKER_PICK_PX;

  for (let i = 0; i < STATE.speakers.length; i++) {
    const s = STATE.speakers[i];
    if (!s.enabled) continue;
    const proj = projectToScreen(s.x, s.y, s.z);
    if (!proj || proj.behind) continue;
    const ddx = proj.sx - mx, ddy = proj.sy - my;
    if (ddx*ddx + ddy*ddy > tolSq) continue;
    // Depth tiebreak — world-space distance from eye, squared.
    const wx = s.x - ex, wy = s.y - ey, wz = s.z - ez;
    const wDistSq = wx*wx + wy*wy + wz*wz;
    if (wDistSq < bestDepthSq) {
      bestDepthSq = wDistSq;
      best = { idx: i, id: s.id, speaker: s };
    }
  }
  return best;
}

const HOVER = { speakerId: null, lastTriIdx: -1, mx: -1, my: -1 };

function positionTooltip(el, mx, my) {
  const rect = el.getBoundingClientRect();
  const pad = 10, offsetX = 14, offsetY = 14;
  let left = mx + offsetX;
  let top  = my + offsetY;
  if (left + rect.width  + pad > window.innerWidth)  left = mx - rect.width  - offsetX;
  if (top  + rect.height + pad > window.innerHeight) top  = my - rect.height - offsetY;
  if (left < pad) left = pad;
  if (top  < pad) top  = pad;
  el.style.left = left + 'px';
  el.style.top  = top  + 'px';
}

function showTriangleTooltip(hit, mx, my, el) {
  const r = TRIANGULATION.result;
  const m = r.metrics[hit];
  const f = r.faces[hit];
  // Vertex names from each merged point's `names` array (sliver-merge groups
  // join with " + "). For unmerged points, names is just [originalName].
  if (hit !== HOVER.lastTriIdx) {
    const vNames = [f.a, f.b, f.c]
      .map(i => (r.points[i].names || [r.points[i].name]).join(' + '))
      .join(', ');
    el.querySelector('[data-tt="maxAngle"]').textContent = `${(m.maxAngle * 180 / Math.PI).toFixed(1)}°`;
    el.querySelector('[data-tt="area"]').textContent = `${m.area.toFixed(3)} sr (${m.areaRatio.toFixed(2)}× median)`;
    el.querySelector('[data-tt="level"]').textContent = m.level;
    el.querySelector('[data-tt="region"]').textContent = m.region;
    el.querySelector('[data-tt="vertices"]').textContent = vNames;
    el.dataset.level = m.level;
    HOVER.lastTriIdx = hit;
  }
  el.hidden = false;
  positionTooltip(el, mx, my);
}

function showSpeakerTooltip(hit, mx, my, el) {
  const s = hit.speaker;
  // Always rewrite — speaker properties (yaw/pitch/spread/distance) can
  // change while hovering, e.g. user adjusts a slider. Tiny DOM cost.
  const u = STATE.view.unit;
  el.querySelector('[data-tt="name"]').textContent = s.name || '(unnamed)';
  el.querySelector('[data-tt="position"]').textContent =
    `${fmtCoord(s.x)}, ${fmtCoord(s.y)}, ${fmtCoord(s.z)} ${u}`;
  el.querySelector('[data-tt="orientation"]').textContent =
    `Yaw ${s.yaw}°, Pitch ${s.pitch}°`;
  el.querySelector('[data-tt="spread"]').textContent =
    `H ${s.angleH}°, V ${s.angleV}°`;
  // Distance + delay — same formula as the per-speaker caption.
  const dx = s.x;
  const dy = s.y;
  const dz = s.z - STATE.audience.listeningHeight;
  const cm = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const ms = (cm / 100 / SPEED_OF_SOUND_MPS) * 1000;
  const dist = u === 'm' ? `${(cm/100).toFixed(2)} m` : `${cm.toFixed(0)} cm`;
  el.querySelector('[data-tt="distance"]').textContent = `${dist} · ${ms.toFixed(1)} ms`;
  el.hidden = false;
  positionTooltip(el, mx, my);
}

function updateHoverTooltips(mx, my, hideForPanel) {
  const triEl = document.getElementById('triangle-tooltip');
  const spkEl = document.getElementById('speaker-tooltip');
  if (!triEl || !spkEl) return;

  // Hide while orbiting — picking is meaningless mid-drag and the tooltip
  // would jitter wildly. mouseIsPressed comes from p5 globals.
  const orbiting = (typeof mouseIsPressed !== 'undefined' && mouseIsPressed) && !_dragStartedOnPanel;
  if (hideForPanel || orbiting) {
    triEl.hidden = true;
    spkEl.hidden = true;
    HOVER.speakerId = null;
    HOVER.lastTriIdx = -1;
    return;
  }

  // Speaker takes priority over triangle when both would hit.
  const spk = pickSpeaker(mx, my);
  if (spk) {
    triEl.hidden = true;
    HOVER.lastTriIdx = -1;
    HOVER.speakerId = spk.id;
    showSpeakerTooltip(spk, mx, my, spkEl);
    return;
  }
  HOVER.speakerId = null;
  spkEl.hidden = true;

  const triHit = pickTriangle(mx, my);
  if (triHit < 0) {
    triEl.hidden = true;
    HOVER.lastTriIdx = -1;
    return;
  }
  showTriangleTooltip(triHit, mx, my, triEl);
}

function installTooltipHandlers() {
  // Listen on document so we get events regardless of which element is the
  // direct target. Existing _pointerCurrentlyOverPanel tracks panel hover
  // (set by the panel-guard mousemove listener in capture phase) — we reuse
  // that signal.
  document.addEventListener('mousemove', (e) => {
    HOVER.mx = e.clientX;
    HOVER.my = e.clientY;
    updateHoverTooltips(e.clientX, e.clientY, _pointerCurrentlyOverPanel);
  });
}

// Dev test harness — run from devtools console: __triangulationDevTests().
// Pure-function checks against analyseTriangulation. Stashes & restores STATE
// so the running app isn't disturbed. Not auto-run.
function __triangulationDevTests() {
  const results = [];
  function check(name, cond, detail) {
    const ok = !!cond;
    results.push({ name, ok });
    (ok ? console.log : console.error)((ok ? 'OK  ' : 'FAIL') + ': ' + name, detail || '');
  }

  const stash = {
    speakers: STATE.speakers,
    phantoms: STATE.phantoms,
    listeningHeight: STATE.audience.listeningHeight,
  };

  function setLayout(speakers, phantoms = [], listeningHeight = 120) {
    STATE.audience.listeningHeight = listeningHeight;
    STATE.speakers = speakers.map((s, i) => ({
      id: 't' + i, name: s.name || ('S' + i),
      enabled: s.enabled !== false,
      x: s.x, y: s.y, z: s.z,
      yaw: 0, pitch: 0, angleH: 90, angleV: 60,
    }));
    STATE.phantoms = phantoms.map((p, i) => ({
      id: 'tp' + i, name: p.name || ('P' + i),
      x: p.x, y: p.y, z: p.z,
    }));
  }

  // 1. Too-few enabled points.
  setLayout([{ x: 100, y: 0, z: 120 }, { x: 0, y: 100, z: 120 }, { x: -100, y: 0, z: 120 }]);
  let r = analyseTriangulation();
  check('too-few(3)', r.kind === 'too-few' && r.count === 3, r);

  // 2. Point exactly at the listening centre — single name.
  setLayout([
    { name: 'X', x: 0, y: 0, z: 120 },
    { x: 200, y: 0, z: 120 }, { x: 0, y: 200, z: 120 }, { x: -200, y: 0, z: 120 },
  ]);
  r = analyseTriangulation();
  check('point-at-centre-single',
    r.kind === 'point-at-centre' && r.names.length === 1 && r.names[0] === 'X',
    r);
  check('point-at-centre-grammar-1',
    triangulationStatusText(r) === '“X” sits on the listening centre — cannot triangulate.',
    triangulationStatusText(r));

  // 2b. Multiple points at the listening centre — names should be collected,
  // status grammar should use plural verb and join correctly.
  setLayout([
    { name: 'L', x: 0, y: 0, z: 120 },
    { name: 'R', x: 0, y: 0, z: 120 },
    { x: 200, y: 0, z: 120 }, { x: 0, y: 200, z: 120 },
  ]);
  r = analyseTriangulation();
  check('point-at-centre-multi',
    r.kind === 'point-at-centre' && r.names.length === 2,
    r);
  check('point-at-centre-grammar-2',
    triangulationStatusText(r) === '“L” and “R” sit on the listening centre — cannot triangulate.',
    triangulationStatusText(r));

  // 2c. Five points at centre → status caption truncates to first 3 + "and N more".
  setLayout([
    { name: 'A', x: 0, y: 0, z: 120 },
    { name: 'B', x: 0, y: 0, z: 120 },
    { name: 'C', x: 0, y: 0, z: 120 },
    { name: 'D', x: 0, y: 0, z: 120 },
    { name: 'E', x: 0, y: 0, z: 120 },
    { x: 200, y: 0, z: 120 },
  ]);
  r = analyseTriangulation();
  check('point-at-centre-grammar-many',
    triangulationStatusText(r) === '“A”, “B”, “C”, and 2 more sit on the listening centre — cannot triangulate.',
    triangulationStatusText(r));

  // 3. Coplanar — 4 speakers all at ear height (canonical theatre LCR/sub case).
  setLayout([
    { x: -300, y: 200, z: 120 }, { x: 300, y: 200, z: 120 },
    { x: 0, y: -300, z: 120 }, { x: 0, y: 300, z: 120 },
  ]);
  r = analyseTriangulation();
  check('planar-4pts-ear-height', r.kind === 'planar' && r.points.length === 4, r);

  // 4. Tetrahedron — genuinely 3D, should be 'ok' with 4 faces. Manifold
  // invariant should hold (each undirected edge shared by exactly 2 faces;
  // V − E + F = 2). Status text reflects the new "→ K triangles" format.
  setLayout([
    { x: 200, y: 200, z: 240 }, { x: -200, y: 200, z: 240 },
    { x: 0, y: -200, z: 240 }, { x: 0, y: 0, z: 60 },
  ]);
  r = analyseTriangulation();
  check('ok-tetrahedron-points', r.kind === 'ok' && r.points.length === 4, r);
  check('ok-tetrahedron-faces', r.kind === 'ok' && r.faces.length === 4, r);
  try {
    assertManifoldOrThrow(r.faces);
    check('ok-tetrahedron-manifold', true);
  } catch (e) {
    check('ok-tetrahedron-manifold', false, e.message);
  }
  check('ok-metrics-shape',
    r.kind === 'ok'
    && Array.isArray(r.metrics) && r.metrics.length === 4
    && r.healthSummary.green + r.healthSummary.yellow + r.healthSummary.red === 4
    && typeof r.medianArea === 'number',
    r);

  // 5. Mixed speakers + phantoms — both contribute.
  setLayout(
    [{ x: -300, y: 200, z: 240 }, { x: 300, y: 200, z: 240 }],
    [{ x: 0, y: -300, z: 240 }, { x: 0, y: 0, z: 350 }],
  );
  r = analyseTriangulation();
  check('mixed-speaker-phantom-counts', r.kind === 'ok' && r.points.length === 4, r);

  // 6. Disabled speaker is excluded from the count.
  setLayout([
    { x: 200, y: 0, z: 240 }, { x: -200, y: 0, z: 240 },
    { x: 0, y: 200, z: 240 },
    { x: 0, y: -200, z: 240, enabled: false },
  ]);
  r = analyseTriangulation();
  check('disabled-excluded', r.kind === 'too-few' && r.count === 3, r);

  // 7. Collinear input → falls through to 'too-few' after sliver merge.
  // Geometric note: a line through origin has at most 2 distinct directions
  // (forward/back), so any "collinear" input merges to ≤2 points and the
  // too-few check fires first. The 'collinear' branch in analyseTriangulation
  // remains as defensive code for numerical edge cases but is essentially
  // unreachable through the normal user flow.
  setLayout([
    { x: 100, y: 0, z: 120 }, { x: 200, y: 0, z: 120 },
    { x: 300, y: 0, z: 120 }, { x: -100, y: 0, z: 120 },
  ]);
  r = analyseTriangulation();
  check('collinear-merges-to-too-few',
    r.kind === 'too-few' && r.count === 2 && r.mergeReduction === 2,
    r);

  // 8. Azimuth ordering on a planar layout — points should sort around the centre.
  setLayout([
    { name: 'E', x: 300, y: 0, z: 120 },
    { name: 'N', x: 0, y: 300, z: 120 },
    { name: 'W', x: -300, y: 0, z: 120 },
    { name: 'S', x: 0, y: -300, z: 120 },
  ]);
  r = analyseTriangulation();
  const order = r.kind === 'planar' ? r.points.map(p => p.name).join('') : '';
  // Acceptable cyclic orderings: ENWS or its rotations / reverses (depending
  // on which pair won the cross product and the resulting normal sign).
  const validCycles = ['ENWS', 'NWSE', 'WSEN', 'SENW', 'SWNE', 'WNES', 'NESW', 'ESWN'];
  check('planar-azimuth-sorted', validCycles.includes(order), 'order=' + order);

  // 9. Octahedron — 6 points along ±X / ±Y / ±Z directions from listening
  // centre. Hull = 8 equilateral spherical triangles. Strong stress test:
  // the seed picks 4 of these 6 vertices and the remaining 2 must be
  // inserted via horizon walk on opposite sides of the hull.
  setLayout([
    { name: '+X', x: 1000, y: 0, z: 120 },
    { name: '-X', x: -1000, y: 0, z: 120 },
    { name: '+Y', x: 0, y: 1000, z: 120 },
    { name: '-Y', x: 0, y: -1000, z: 120 },
    { name: '+Z', x: 0, y: 0, z: 1120 },  // listeningHeight + 1000
    { name: '-Z', x: 0, y: 0, z: -880 },  // listeningHeight - 1000
  ]);
  r = analyseTriangulation();
  check('octahedron-faces', r.kind === 'ok' && r.faces.length === 8, r);
  try {
    assertManifoldOrThrow(r.faces);
    check('octahedron-manifold', true);
  } catch (e) {
    check('octahedron-manifold', false, e.message);
  }

  // 10. Cube vertices on the sphere — 8 points, hull is the cube triangulated
  // = 12 faces. Tests handling of larger horizon walks (each insertion past
  // the seed deletes 2-3 visible faces).
  {
    const c = 600;
    const z0 = 120;  // listeningHeight; Δz from centre = ±c
    setLayout([
      { x: c, y: c, z: z0 + c }, { x: -c, y: c, z: z0 + c },
      { x: c, y: -c, z: z0 + c }, { x: -c, y: -c, z: z0 + c },
      { x: c, y: c, z: z0 - c }, { x: -c, y: c, z: z0 - c },
      { x: c, y: -c, z: z0 - c }, { x: -c, y: -c, z: z0 - c },
    ]);
  }
  r = analyseTriangulation();
  check('cube-faces', r.kind === 'ok' && r.faces.length === 12, r);
  try {
    assertManifoldOrThrow(r.faces);
    check('cube-manifold', true);
  } catch (e) {
    check('cube-manifold', false, e.message);
  }

  // 11. Sliver pre-merge — two near-identical directions collapse into one.
  // Setup: 4 well-spread points + 1 sliver-twin of the first → 5 inputs,
  // 4 merged points, 1 sliver-merged. Result still 'ok' with 4 faces.
  setLayout([
    { name: 'A',  x: 300, y: 300, z: 240 },
    { name: "A'", x: 301, y: 301, z: 240 },  // ~0.001 rad from A — well below 0.05
    { name: 'B',  x: -300, y: 300, z: 240 },
    { name: 'C',  x: 0, y: -300, z: 240 },
    { name: 'D',  x: 0, y: 0, z: 30 },
  ]);
  r = analyseTriangulation();
  check('sliver-merge-count',
    r.kind === 'ok' && r.points.length === 4 && r.inputCount === 5 && r.mergeReduction === 1,
    r);
  check('sliver-merge-status-format',
    /^3D layout — 4 points → 4 triangles( · \S.*?)? \(1 sliver-merged\)\.$/.test(triangulationStatusText(r)),
    triangulationStatusText(r));

  // 12. Sliver merge can reduce below 4 → 'too-few'. 4 inputs in 2 sliver pairs.
  setLayout([
    { name: 'A1', x: 300, y: 300, z: 240 },
    { name: 'A2', x: 301, y: 301, z: 240 },
    { name: 'B1', x: -300, y: -300, z: 240 },
    { name: 'B2', x: -301, y: -301, z: 240 },
  ]);
  r = analyseTriangulation();
  check('sliver-merge-to-too-few',
    r.kind === 'too-few' && r.count === 2 && r.inputCount === 4 && r.mergeReduction === 2,
    r);

  // 13. 50 random 3D points on the sphere → manifold-valid hull.
  // Deterministic seed via simple LCG so the test is reproducible across runs.
  let seed = 1;
  const lcg = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const random50 = [];
  for (let i = 0; i < 50; i++) {
    // Uniform sphere sampling: u ∈ [-1, 1], θ ∈ [0, 2π); (sqrt(1−u²)cosθ, sqrt(1−u²)sinθ, u).
    const u = 2 * lcg() - 1;
    const theta = 2 * Math.PI * lcg();
    const r2 = Math.sqrt(1 - u * u);
    const dx = r2 * Math.cos(theta);
    const dy = r2 * Math.sin(theta);
    const dz = u;
    // Place 1000cm out from the listening centre along (dx, dy, dz).
    random50.push({ x: dx * 1000, y: dy * 1000, z: 120 + dz * 1000 });
  }
  setLayout(random50);
  r = analyseTriangulation();
  // For a 3D point cloud with no degeneracies, expect 'ok' and Euler-valid hull.
  // Vertex count V ≤ 50 (some may be inside hull); F = 2V − 4 by Euler.
  check('random50-ok', r.kind === 'ok', r.kind);
  try {
    assertManifoldOrThrow(r.faces);
    check('random50-manifold', true);
  } catch (e) {
    check('random50-manifold', false, e.message);
  }
  // healthSummary buckets must sum to the total face count. Catches both
  // missing classification and double-counting.
  {
    const s = r.healthSummary;
    check('random50-summary-totals',
      s.green + s.yellow + s.red === r.faces.length,
      { summary: s, faces: r.faces.length });
  }

  // 14. Regular tetrahedron metrics — 4 equilateral spherical triangles with
  // arc length acos(−1/3) ≈ 109.47°. Closed-form values: area = π per face,
  // max interior angle = 2π/3 (120°). All faces classify red (max > 90°).
  // Vertex placements chosen so directions = ±(1,1,1)/√3, etc.
  const approx = (x, y, eps = 1e-9) => Math.abs(x - y) < eps;
  setLayout([
    { x:  100, y:  100, z: 220 },  // direction (+1,+1,+1)/√3
    { x:  100, y: -100, z:  20 },  // direction (+1,−1,−1)/√3
    { x: -100, y:  100, z:  20 },  // direction (−1,+1,−1)/√3
    { x: -100, y: -100, z: 220 },  // direction (−1,−1,+1)/√3
  ]);
  r = analyseTriangulation();
  check('regular-tetra-area',
    r.metrics.every(m => approx(m.area, Math.PI)),
    r.metrics.map(m => m.area));
  check('regular-tetra-max-angle',
    r.metrics.every(m => approx(m.maxAngle, 2 * Math.PI / 3)),
    r.metrics.map(m => m.maxAngle));
  check('regular-tetra-area-ratio',
    r.metrics.every(m => approx(m.areaRatio, 1)),
    r.metrics.map(m => m.areaRatio));
  check('regular-tetra-all-red',
    r.healthSummary.red === 4 && r.healthSummary.yellow === 0 && r.healthSummary.green === 0,
    r.healthSummary);
  // M3.E moved health summary and symmetry warnings out of the caption and
  // into the Layout Health panel. Caption now reports only the kind +
  // counts; the panel surface carries severity / symmetry signals.
  check('regular-tetra-caption',
    triangulationStatusText(r) === '3D layout — 4 points → 4 triangles.',
    triangulationStatusText(r));
  check('regular-tetra-symmetry-red',
    r.symmetry && r.symmetry.level === 'red' && approx(r.symmetry.delta, Math.acos(1/3)),
    r.symmetry);
  // Panel composition: red triangles + red symmetry both surface as fail
  // lines. Region of all 4 red triangles for the regular tetrahedron is
  // determined by their centroids — verify a fail-level line is emitted.
  {
    const lines = composeHealthLines(r);
    check('regular-tetra-panel-2-lines', lines.length === 2, lines);
    check('regular-tetra-panel-fail-triangles',
      lines[0].level === 'fail' && /problematic triangles? detected/.test(lines[0].text),
      lines[0]);
    check('regular-tetra-panel-asymmetric',
      lines[1].level === 'fail' && /Layout is asymmetric/.test(lines[1].text),
      lines[1]);
  }

  // 15. Regular octahedron metrics — 8 equilateral spherical triangles with
  // arc length π/2 (90°). Area = π/2 per face, max interior angle = π/2.
  // Classification: YELLOW (max angle > 70° but NOT strictly > 90°).
  setLayout([
    { x:  1000, y:     0, z:  120 }, { x: -1000, y:    0, z:  120 },
    { x:     0, y:  1000, z:  120 }, { x:     0, y: -1000, z:  120 },
    { x:     0, y:     0, z: 1120 }, { x:     0, y:    0, z: -880 },
  ]);
  r = analyseTriangulation();
  check('regular-octa-area',
    r.metrics.every(m => approx(m.area, Math.PI / 2)),
    r.metrics.map(m => m.area));
  check('regular-octa-max-angle',
    r.metrics.every(m => approx(m.maxAngle, Math.PI / 2)),
    r.metrics.map(m => m.maxAngle));
  check('regular-octa-all-yellow',
    r.healthSummary.yellow === 8 && r.healthSummary.red === 0 && r.healthSummary.green === 0,
    r.healthSummary);
  // Regular octahedron has full L/R symmetry: ±X, ±Y, ±Z are all closed
  // under the mirror operation (x → -x), so each original's nearest mirror
  // is itself or its antipode at distance 0.
  check('regular-octa-symmetry-green',
    r.symmetry && r.symmetry.level === 'green' && approx(r.symmetry.delta, 0),
    r.symmetry);

  // ===== Symmetry tests (M3.D) =====

  // S1. Symmetric LCR: mirror pair (L, R) + on-axis (C, P) → Δ ≈ 0, green.
  setLayout([
    { name: 'L', x: -300, y: 200, z: 240 },
    { name: 'R', x:  300, y: 200, z: 240 },
    { name: 'C', x:    0, y: 200, z: 240 },
    { name: 'P', x:    0, y: -200, z: 240 },
  ]);
  r = analyseTriangulation();
  check('symmetric-lcr-green',
    r.symmetry && r.symmetry.level === 'green' && r.symmetry.delta < 1e-9,
    r.symmetry);

  // S2. Slight asymmetry — R nudged to 400 (not the mirror of L's 300) →
  // Δ around 0.07 rad, in the yellow band (0.05 < Δ ≤ 0.15).
  setLayout([
    { name: 'L', x: -300, y: 200, z: 240 },
    { name: 'R', x:  400, y: 200, z: 240 },
    { name: 'C', x:    0, y: 200, z: 240 },
    { name: 'P', x:    0, y: -200, z: 240 },
  ]);
  r = analyseTriangulation();
  check('asymmetric-r-shift-yellow',
    r.symmetry && r.symmetry.level === 'yellow',
    r.symmetry);

  // S3. Heavy asymmetry — single off-X-axis speaker (no mirror partner
  // anywhere in the set) → Δ large, red. Tests the "1 point" path too.
  setLayout([{ name: 'X', x: 200, y: 0, z: 240 }]);
  r = analyseTriangulation();
  check('single-off-axis-red',
    r.kind === 'too-few' && r.symmetry && r.symmetry.level === 'red',
    { kind: r.kind, sym: r.symmetry });

  // S4. Single speaker on the X=0 centerline → mirror is self → Δ exactly 0.
  setLayout([{ name: 'X', x: 0, y: 200, z: 240 }]);
  r = analyseTriangulation();
  check('single-on-centerline-green',
    r.kind === 'too-few' && r.symmetry && r.symmetry.level === 'green' && r.symmetry.delta === 0,
    { kind: r.kind, sym: r.symmetry });

  // S5. Left-heavy layout (3 L vs 1 R, ROADMAP M3 visual check #4) → red.
  setLayout([
    { name: 'L1', x: -300, y:  200, z: 240 },
    { name: 'L2', x: -200, y: -100, z: 240 },
    { name: 'L3', x: -400, y:   50, z: 240 },
    { name: 'R',  x:  300, y:  100, z: 240 },
  ]);
  r = analyseTriangulation();
  check('left-heavy-red',
    r.symmetry && r.symmetry.level === 'red',
    r.symmetry);
  // Panel emits a separate symmetry line on red — verify wording + level.
  {
    const lines = composeHealthLines(r);
    const symLine = lines.find(l => /Layout is asymmetric/.test(l.text));
    check('left-heavy-panel-symmetry-fail',
      symLine && symLine.level === 'fail',
      symLine);
  }

  // S6. Symmetric on planar layout — should attach symmetry to the 'planar'
  // result kind too.
  setLayout([
    { name: 'A', x:  300, y:    0, z: 120 },
    { name: 'B', x: -300, y:    0, z: 120 },
    { name: 'C', x:    0, y:  300, z: 120 },
    { name: 'D', x:    0, y: -300, z: 120 },
  ]);
  r = analyseTriangulation();
  check('planar-carries-symmetry',
    r.kind === 'planar' && r.symmetry && r.symmetry.level === 'green',
    { kind: r.kind, sym: r.symmetry });

  // ===== Region detection (M3.E) =====

  check('region-upper',  regionForCentroid({ x: 0, y: 0, z:  0.9 }) === 'upper hemisphere',  '');
  check('region-lower',  regionForCentroid({ x: 0, y: 0, z: -0.9 }) === 'lower hemisphere',  '');
  check('region-front',  regionForCentroid({ x: 0, y:  0.9, z: 0.2 }) === 'front',           '');
  check('region-rear',   regionForCentroid({ x: 0, y: -0.9, z: 0.2 }) === 'rear',            '');
  check('region-right',  regionForCentroid({ x:  0.9, y: 0.2, z: 0.2 }) === 'right side',    '');
  check('region-left',   regionForCentroid({ x: -0.9, y: 0.2, z: 0.2 }) === 'left side',     '');
  check('region-centerline',
    regionForCentroid({ x: 0.0, y: 0.5, z: 0.5 }) === 'centerline',
    '');
  check('region-surround-ring',
    regionForCentroid({ x: 0.5, y: 0.5, z: 0.0 }) === 'surround ring',
    '');

  // ===== composeHealthLines via synthetic results (M3.E) =====
  // Build minimal result objects that satisfy the lines composer's reads,
  // bypassing analyseTriangulation. This isolates the line composition logic
  // from the upstream pipeline so we can hit every branch deterministically.

  const synthGreen = (level = 'green') => ({
    kind: 'ok',
    points: [{}, {}, {}, {}],
    faces: [{}, {}, {}, {}],
    metrics: [
      { level: 'green', region: 'front' },
      { level: 'green', region: 'rear' },
      { level: 'green', region: 'upper hemisphere' },
      { level: 'green', region: 'lower hemisphere' },
    ],
    healthSummary: { green: 4, yellow: 0, red: 0 },
    symmetry: { delta: 0, level },
    inputCount: 4, mergeReduction: 0,
  });

  let lines = composeHealthLines(synthGreen('green'));
  check('lines-ok-all-green',
    lines.length === 1 && lines[0].level === 'ok'
    && lines[0].text === '✓ Layout looks healthy.',
    lines);

  lines = composeHealthLines(synthGreen('yellow'));
  check('lines-ok-green-with-asymmetric',
    lines.length === 2
    && lines[0].text === '✓ Layout looks healthy.'
    && lines[1].level === 'warn'
    && /Layout is asymmetric/.test(lines[1].text),
    lines);

  // ok with 3 yellow triangles, all in upper hemisphere → dominantRegion
  // selects 'upper hemisphere'.
  lines = composeHealthLines({
    kind: 'ok',
    points: [{}, {}, {}, {}],
    faces: [{}, {}, {}, {}],
    metrics: [
      { level: 'yellow', region: 'upper hemisphere' },
      { level: 'yellow', region: 'upper hemisphere' },
      { level: 'yellow', region: 'front' },
      { level: 'green', region: 'rear' },
    ],
    healthSummary: { green: 1, yellow: 3, red: 0 },
    symmetry: { delta: 0, level: 'green' },
    inputCount: 4, mergeReduction: 0,
  });
  check('lines-ok-yellow-region',
    lines.length === 1 && lines[0].level === 'warn'
    && lines[0].text === '⚠ 3 suspect triangles detected in upper hemisphere. Coverage may degrade.',
    lines);

  // ok with red dominates: red line wins over yellow.
  lines = composeHealthLines({
    kind: 'ok',
    points: [{}, {}, {}, {}],
    faces: [{}, {}, {}, {}],
    metrics: [
      { level: 'red', region: 'rear' },
      { level: 'yellow', region: 'front' },
      { level: 'green', region: 'centerline' },
      { level: 'green', region: 'centerline' },
    ],
    healthSummary: { green: 2, yellow: 1, red: 1 },
    symmetry: { delta: 0, level: 'green' },
    inputCount: 4, mergeReduction: 0,
  });
  check('lines-ok-red-wins',
    lines.length === 1 && lines[0].level === 'fail'
    && lines[0].text === '✗ 1 problematic triangle detected in rear. Consider adding phantom speaker(s).',
    lines);

  // too-few kind
  lines = composeHealthLines({
    kind: 'too-few', count: 3, inputCount: 3, mergeReduction: 0,
    symmetry: { delta: 0, level: 'green' },
  });
  check('lines-too-few',
    lines.length === 1 && lines[0].level === 'warn'
    && lines[0].text === '⚠ Add ≥ 4 enabled speakers or phantoms — only 3 reachable.',
    lines);

  // planar kind → info line, no severity
  lines = composeHealthLines({
    kind: 'planar', points: [{}, {}, {}, {}], normal: {}, inputCount: 4, mergeReduction: 0,
    symmetry: { delta: 0, level: 'green' },
  });
  check('lines-planar',
    lines.length === 1 && lines[0].level === 'info'
    && /Planar layout/.test(lines[0].text),
    lines);

  // point-at-centre with multiple names → fail level + plural grammar
  lines = composeHealthLines({ kind: 'point-at-centre', names: ['L', 'R'] });
  check('lines-point-at-centre-plural',
    lines.length === 1 && lines[0].level === 'fail'
    && lines[0].text === '✗ 2 points sit on the listening centre — cannot triangulate.',
    lines);

  // collinear kind
  lines = composeHealthLines({
    kind: 'collinear', count: 4, inputCount: 4, mergeReduction: 0,
    symmetry: { delta: 0, level: 'green' },
  });
  check('lines-collinear',
    lines.length === 1 && lines[0].level === 'warn'
    && /Speakers are collinear/.test(lines[0].text),
    lines);

  // Small-circle planar: 4 speakers all at constant height above ear level
  // (e.g. overhead cabinets at z=240, listener at z=120). Directions land on
  // a small circle of latitude (z = const ≠ 0). Same panning topology as
  // ear-height speakers (great circle) — both render as a 2D ring under the
  // unified planar branch.
  setLayout([
    { x: -300, y: -300, z: 240 },
    { x:  300, y: -300, z: 240 },
    { x:  300, y:  300, z: 240 },
    { x: -300, y:  300, z: 240 },
  ]);
  r = analyseTriangulation();
  check('small-circle-planar',
    r.kind === 'planar' && r.points.length === 4,
    r);
  // Adding a phantom above the layout breaks the affine-coplanar geometry
  // → directions span 3D properly → hull closes → kind 'ok'.
  setLayout(
    [
      { x: -300, y: -300, z: 240 },
      { x:  300, y: -300, z: 240 },
      { x:  300, y:  300, z: 240 },
      { x: -300, y:  300, z: 240 },
    ],
    [{ x: 0, y: 0, z: 600 }],
  );
  r = analyseTriangulation();
  check('small-circle-closed-by-phantom',
    r.kind === 'ok' && r.points.length === 5 && r.faces.length === 6,
    { kind: r.kind, points: r.points && r.points.length, faces: r.faces && r.faces.length });

  // hull-open kind itself becomes a defensive fallback (unreachable through
  // typical user flow now that small-circle inputs are caught as planar).
  // composeHealthLines still handles it for safety; verify the wording.
  lines = composeHealthLines({
    kind: 'hull-open', count: 4, inputCount: 4, mergeReduction: 0,
    symmetry: { delta: 0, level: 'green' },
  });
  check('lines-hull-open-defensive',
    lines.length === 1 && lines[0].level === 'warn'
    && /add a phantom above or below/.test(lines[0].text),
    lines);

  // ===== pointInTriangle (M3.F) =====
  // Reference triangle: A=(0,0), B=(10,0), C=(0,10). Centroid (10/3, 10/3).
  check('pit-inside-centroid', pointInTriangle(3, 3, 0, 0, 10, 0, 0, 10) === true,  '');
  check('pit-outside-far',     pointInTriangle(20, 20, 0, 0, 10, 0, 0, 10) === false, '');
  check('pit-on-vertex',       pointInTriangle(0, 0, 0, 0, 10, 0, 0, 10) === true,  '');
  check('pit-on-edge-AB',      pointInTriangle(5, 0, 0, 0, 10, 0, 0, 10) === true,  '');
  check('pit-on-edge-hypot',   pointInTriangle(5, 5, 0, 0, 10, 0, 0, 10) === true,  '');
  check('pit-just-outside-AB', pointInTriangle(5, -0.01, 0, 0, 10, 0, 0, 10) === false, '');
  // Reverse vertex winding — pointInTriangle is winding-agnostic (sign test).
  check('pit-reverse-winding', pointInTriangle(3, 3, 0, 0, 0, 10, 10, 0) === true,  '');

  STATE.speakers = stash.speakers;
  STATE.phantoms = stash.phantoms;
  STATE.audience.listeningHeight = stash.listeningHeight;
  TRIANGULATION.dirty = true;  // force fresh next access; we mutated state above

  const passed = results.filter(x => x.ok).length;
  console.log(`Triangulation tests: ${passed}/${results.length} passed.`);
  return { passed, total: results.length, results };
}
if (typeof window !== 'undefined') window.__triangulationDevTests = __triangulationDevTests;

// =============================================================================
// p5 lifecycle
// =============================================================================

function setup() {
  // setAttributes MUST be called before createCanvas — calling it after
  // recreates the WEBGL canvas (and detaches it from #canvas-host), which
  // breaks orbitControl drag because event listeners are bound to the
  // now-orphaned old canvas. preserveDrawingBuffer is needed so the PNG
  // export (M4.A) can drawImage() the WEBGL canvas without it having been
  // cleared after compositing.
  setAttributes({ antialias: true, preserveDrawingBuffer: true });
  const c = createCanvas(windowWidth, windowHeight, WEBGL);
  c.parent('canvas-host');
  // Grab default camera reference BEFORE applyCamera() so we can set yScale
  // (do NOT use createCamera() — that switches the camera to "custom" type
  // and breaks orbitControl drag).
  cam = _renderer._curCamera;
  applyCamera();
  syncSpeakerLabels();
  syncPhantomLabels();
  syncCoordLabels();
  installPanelEventGuards();
  installTooltipHandlers();
  computeCoverage();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  applyCamera();
}

function draw() {
  background('#f3f3f6');
  // Single mechanism for handedness: cam.yScale = -1 set in applyCamera().
  // No per-view scale flips — every preset stays right-handed by construction.
  if (allowCanvasInteraction()) {
    orbitControl(1.5, 1.5, 0.5);
  } else if (typeof _renderer !== 'undefined' && _renderer) {
    // Drop any wheel-zoom inertia accumulated while the pointer was over a
    // panel, so moving back onto the canvas doesn't snap-zoom.
    _renderer.zoomVelocity = 0;
  }
  drawScene();
  try {
    updateLabels();
  } catch (e) {
    console.warn('updateLabels error:', e);
  }
}

// =============================================================================
// Scene rendering — coords are world (+X right, +Y forward, +Z up).
// =============================================================================

function drawScene() {
  const L = STATE.view.layers;
  // Soft scene lighting: gives spheres (origin marker, listening centre,
  // speaker bodies) a subtle 3D shading without competing with the
  // diagrammatic flat aesthetic. Tuned so a fully-lit fragment is roughly
  // the original fill colour and a fully-shaded fragment is about half —
  // gentle gradient, no harsh contrast.
  // p5's stroke() is not affected by lights, so axes, floor grid, and cone
  // wireframes stay crisp regardless. Direction is in world coords; chosen
  // so the lit side faces the perspective camera (upper-front-right), which
  // is the most common viewing angle.
  ambientLight(120);
  directionalLight(180, 180, 170, -0.3, 0.4, -0.85);

  if (L.floor)              drawFloorGrid();
  if (L.axes)               drawAxesLines();
  if (L.audience)           drawAudience();
  if (L['listening-plane']) drawListeningPlane();
  // Heatmap sits 1cm above the listening plane; render it after the plane so
  // ordering matches the eye-line order. Depth test stays on so cones / drop
  // line below the heatmap are unaffected.
  if (L['coverage-heat'])   drawCoverageHeat();
  // Drop line is depth-tested so it sits "inside" the scene properly
  // (audience plane, listening plane, etc. occlude it where appropriate).
  if (L['listening-centre']) drawListeningCentreDropLine();

  // First pass: cones, depth-tested as usual.
  if (L.cones) {
    for (const s of STATE.speakers) {
      if (s.enabled) drawSpeakerCone(s);
    }
  }

  // Second pass: position markers as "always on top" — depth test disabled so
  // they're never occluded. Treat them as 2D-feeling anchors, like the HTML
  // labels. Listening-centre marker shares this pass for the same reason: it
  // is the conceptual anchor of the entire layout and must always be visible.
  // Phantoms also belong here: they're sketches of "panning slots", same
  // semantic role as a speaker body marker.
  const wantSpeakers      = L.speakers;
  const wantCentre        = L['listening-centre'];
  const wantPhantoms      = L.phantoms;
  const wantTriangulation = L.triangulation;
  if (wantTriangulation) ensureTriangulationFresh();
  if (wantSpeakers || wantCentre || wantPhantoms || wantTriangulation) {
    const gl = drawingContext;
    gl.disable(gl.DEPTH_TEST);
    // Triangulation drawn first in the pass so speaker / centre / phantom
    // markers paint on top of its lines — markers are the foreground anchors,
    // the geometric overlay is the background structure.
    if (wantTriangulation) drawTriangulation();
    if (wantSpeakers) {
      for (const s of STATE.speakers) {
        if (s.enabled) drawSpeakerBody(s);
      }
    }
    if (wantCentre) drawListeningCentreMarker();
    if (wantPhantoms) {
      for (const p of STATE.phantoms) drawPhantomBody(p);
    }
    gl.enable(gl.DEPTH_TEST);
  }
}

function drawFloorGrid() {
  push();
  noFill();
  strokeWeight(1);
  stroke(210);
  const step = 100;
  const extent = 1200;
  for (let v = -extent; v <= extent; v += step) {
    if (v === 0) continue;  // origin lines are coloured by drawAxesLines
    beginShape(LINES); vertex(v, -extent, 0); vertex(v,  extent, 0); endShape();
    beginShape(LINES); vertex(-extent, v, 0); vertex( extent, v, 0); endShape();
  }
  // origin marker (lifted brightness so the directional gradient registers)
  push();
  noStroke();
  fill(110);
  sphere(7);
  pop();
  pop();
}

function drawAxesLines() {
  push();
  strokeWeight(2);
  const len = 500;
  stroke(220, 60, 60);
  beginShape(LINES); vertex(0, 0, 0); vertex(len, 0, 0); endShape();
  stroke(60, 160, 80);
  beginShape(LINES); vertex(0, 0, 0); vertex(0, len, 0); endShape();
  stroke(60, 100, 220);
  beginShape(LINES); vertex(0, 0, 0); vertex(0, 0, len); endShape();
  pop();
  // Labels rendered via HTML overlay; see updateLabels().
}

function drawAudience() {
  const lx = STATE.audience.length / 2;
  const ly = STATE.audience.width / 2;
  push();
  noStroke();
  fill(80, 80, 100, 50);
  beginShape();
  vertex(-lx, -ly, 0); vertex(+lx, -ly, 0); vertex(+lx, +ly, 0); vertex(-lx, +ly, 0);
  endShape(CLOSE);
  stroke(80, 80, 100, 180);
  strokeWeight(1);
  noFill();
  beginShape();
  vertex(-lx, -ly, 0); vertex(+lx, -ly, 0); vertex(+lx, +ly, 0); vertex(-lx, +ly, 0);
  endShape(CLOSE);
  pop();
}

function drawListeningPlane() {
  const lx = STATE.audience.length / 2;
  const ly = STATE.audience.width / 2;
  const z  = STATE.audience.listeningHeight;
  // When the coverage heatmap is on, skip the blue fill — the heatmap will
  // tint the same plane just above (z+1cm), and the extra translucent layer
  // here would only mute the heatmap's colour bands. Outline still drawn so
  // the plane edge stays legible.
  const fillPlane = !STATE.view.layers['coverage-heat'];
  push();
  if (fillPlane) {
    noStroke();
    fill(180, 200, 255, 45);
    beginShape();
    vertex(-lx, -ly, z); vertex(+lx, -ly, z); vertex(+lx, +ly, z); vertex(-lx, +ly, z);
    endShape(CLOSE);
  }
  stroke(140, 170, 220, 140);
  strokeWeight(1);
  noFill();
  beginShape();
  vertex(-lx, -ly, z); vertex(+lx, -ly, z); vertex(+lx, +ly, z); vertex(-lx, +ly, z);
  endShape(CLOSE);
  pop();
}

function drawSpeakerBody(s) {
  push();
  noStroke();
  // Soft slate-navy: previous (30, 35, 55) was so dark that even fully-lit
  // shading topped out around (60, 70, 95) — visually indistinguishable from
  // black, so spheres looked like flat discs. This tone keeps the "tasteful
  // dark" feel but lives in the range where the directional gradient is
  // actually visible.
  // Hover highlight (M3.G): the speaker pointed at by HOVER.speakerId
  // brightens toward a soft sky tone so the user can confirm "this is the
  // speaker the tooltip describes". Same hue family as the base, just lifted.
  if (HOVER.speakerId === s.id) {
    fill(180, 200, 240);
  } else {
    fill(110, 122, 150);
  }
  translate(s.x, s.y, s.z);
  sphere(26);
  pop();
}

// Phantom marker — soft violet, smaller than speaker bodies and slightly
// translucent so it reads as "imagined / sketched" rather than "real cabinet".
// Drawn in the same depth-test-off pass as speaker bodies (callers handle
// the GL state). Distinct hue from speaker navy / listening-centre teal /
// cone orange — phantoms are a 4th category and earn their own colour slot.
// SPEC §8.4 frames phantoms as "reserve a panning slot", which the visual
// translates as "marker that takes the same anchor role as a speaker body
// but reads as virtual".
function drawPhantomBody(p) {
  push();
  noStroke();
  // Pale lavender (option A from M3.A colour discussion). Light enough to
  // read as "imagined / ghostly" against the listening plane while still
  // distinguishable from the speaker navy / listening-centre teal /
  // cone orange palette.
  fill(200, 180, 220, 220);
  translate(p.x, p.y, p.z);
  sphere(16);
  pop();
}

// Listening centre = the conceptual anchor of the whole layout, at
// (0, 0, listeningHeight). Rendered as a teal sphere with a dashed drop
// line down to the floor projection (the world origin where the axes meet),
// so the relationship "Z is measured from floor; ears live up here" is
// visible at a glance. Teal is chosen to stand apart from speaker navy,
// cone orange, and axis R/G/B.
function drawListeningCentreDropLine() {
  const h = STATE.audience.listeningHeight;
  if (h <= 0) return;
  push();
  stroke(40, 150, 150, 200);
  strokeWeight(1.2);
  const dash = 8;
  const gap = 8;
  for (let z = 0; z < h; z += dash + gap) {
    const z1 = Math.min(z + dash, h);
    beginShape(LINES);
    vertex(0, 0, z);
    vertex(0, 0, z1);
    endShape();
  }
  pop();
}

function drawListeningCentreMarker() {
  const h = STATE.audience.listeningHeight;
  push();
  noStroke();
  fill(40, 150, 150);
  translate(0, 0, h);
  sphere(11);
  pop();
}

// Wireframe cone (rectangular pyramid): 4 edge rays + base outline + very
// faint base fill. Base is flat and perpendicular to the speaker forward
// direction, so it always renders as a real rectangle regardless of pitch.
// Speaker body is drawn with depth test off elsewhere, so we don't need to
// avoid the apex.
//
// Edge alphas are tuned for "readable on top of heatmap": rays carry the
// least information (just connect apex to corners) so they get the lowest
// alpha; the base outline shows where the cone's footprint lands and is
// kept stronger.
function drawSpeakerCone(s) {
  const length = 400;
  const corners = coneCorners(s, length);

  push();
  // very faint base fill — kept low so the heatmap colour band underneath
  // still reads at the cone footprint.
  noStroke();
  fill(255, 190, 70, 14);
  beginShape();
  for (const c of corners) vertex(c.x, c.y, c.z);
  endShape(CLOSE);

  // edge rays — softened to avoid fighting the heatmap.
  stroke(220, 150, 40, 90);
  strokeWeight(1);
  noFill();
  for (const c of corners) {
    beginShape(LINES);
    vertex(s.x, s.y, s.z);
    vertex(c.x, c.y, c.z);
    endShape();
  }

  // base outline — slightly stronger than the rays since it carries the
  // useful "where the cone lands" information.
  stroke(220, 150, 40, 140);
  strokeWeight(1.2);
  beginShape();
  for (const c of corners) vertex(c.x, c.y, c.z);
  endShape(CLOSE);
  pop();
}

// =============================================================================
// HTML overlay labels — replaces unreliable p5 WEBGL text().
// =============================================================================

function syncSpeakerLabels() {
  const host = document.getElementById('speaker-labels');
  if (!host) return;
  const wantedIds = new Set(STATE.speakers.map(s => 'speaker-label-' + s.id));
  Array.from(host.children).forEach(el => {
    if (!wantedIds.has(el.id)) el.remove();
  });
  for (const s of STATE.speakers) {
    const id = 'speaker-label-' + s.id;
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('span');
      el.id = id;
      el.className = 'overlay-label speaker-label';
      host.appendChild(el);
    }
    el.textContent = s.name;
  }
}

function syncPhantomLabels() {
  const host = document.getElementById('phantom-labels');
  if (!host) return;
  const wantedIds = new Set(STATE.phantoms.map(p => 'phantom-label-' + p.id));
  Array.from(host.children).forEach(el => {
    if (!wantedIds.has(el.id)) el.remove();
  });
  for (const p of STATE.phantoms) {
    const id = 'phantom-label-' + p.id;
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('span');
      el.id = id;
      el.className = 'overlay-label phantom-label';
      host.appendChild(el);
    }
    el.textContent = p.name;
  }
}

// =============================================================================
// Coord overlay labels — one span per speaker plus an origin span. Visibility
// follows STATE.view.layers.coords; they're created up-front and toggled.
// =============================================================================

function syncCoordLabels() {
  const host = document.getElementById('coord-labels');
  if (!host) return;
  const wantedIds = new Set(STATE.speakers.map(s => 'coord-label-' + s.id));
  for (const p of STATE.phantoms) wantedIds.add('coord-label-' + p.id);
  wantedIds.add('coord-label-origin');
  wantedIds.add('coord-label-centre');
  Array.from(host.children).forEach(el => {
    if (!wantedIds.has(el.id)) el.remove();
  });
  ensureLabel('coord-label-origin', 'coord-label-origin');
  ensureLabel('coord-label-centre', 'coord-label-centre');
  for (const s of STATE.speakers) {
    ensureLabel('coord-label-' + s.id, '');
  }
  for (const p of STATE.phantoms) {
    // Phantom coord labels share the soft-violet styling with the name label
    // so the user can see at a glance which value belongs to which marker.
    ensureLabel('coord-label-' + p.id, 'coord-label-phantom');
  }

  function ensureLabel(id, extraClass) {
    if (document.getElementById(id)) return;
    const el = document.createElement('span');
    el.id = id;
    el.className = 'overlay-label coord-label' + (extraClass ? ' ' + extraClass : '');
    host.appendChild(el);
  }
}

function fmtCoord(cm) {
  const v = lenDisplay(cm);
  // Show ints clean, fractions to 1 dp; trim trailing zero.
  const rounded = Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v).toString() : v.toFixed(1);
  return rounded;
}

function updateCoordLabelTexts() {
  const u = STATE.view.unit;
  for (const s of STATE.speakers) {
    const el = document.getElementById('coord-label-' + s.id);
    if (!el) continue;
    el.textContent = `${s.name} (${fmtCoord(s.x)}, ${fmtCoord(s.y)}, ${fmtCoord(s.z)} ${u})`;
  }
  for (const p of STATE.phantoms) {
    const el = document.getElementById('coord-label-' + p.id);
    if (!el) continue;
    el.textContent = `${p.name} (${fmtCoord(p.x)}, ${fmtCoord(p.y)}, ${fmtCoord(p.z)} ${u})`;
  }
  const origin = document.getElementById('coord-label-origin');
  if (origin) origin.textContent = `Origin (0, 0, 0 ${u})`;
  const centre = document.getElementById('coord-label-centre');
  if (centre) centre.textContent = `Listening centre (0, 0, ${fmtCoord(STATE.audience.listeningHeight)} ${u})`;
}

// Project a world-space point to canvas pixel coordinates by manually
// multiplying the view × projection matrix that p5 maintains on the camera.
// Avoids screenX/screenY which are unreliable in p5 v1.11 WEBGL.
// projMatrix already reflects yScale = -1, so the (1 - cy/cw) flip below
// continues to produce correct pixel y for all camera presets.
function projectToScreen(x, y, z) {
  if (!cam || !cam.cameraMatrix || !cam.projMatrix) return null;
  const vm = cam.cameraMatrix.mat4;  // column-major Float32Array
  const pm = cam.projMatrix.mat4;

  // world -> view
  const vx = vm[0]*x + vm[4]*y + vm[8] *z + vm[12];
  const vy = vm[1]*x + vm[5]*y + vm[9] *z + vm[13];
  const vz = vm[2]*x + vm[6]*y + vm[10]*z + vm[14];
  const vw = vm[3]*x + vm[7]*y + vm[11]*z + vm[15];

  // view -> clip
  const cx = pm[0]*vx + pm[4]*vy + pm[8] *vz + pm[12]*vw;
  const cy = pm[1]*vx + pm[5]*vy + pm[9] *vz + pm[13]*vw;
  const cw = pm[3]*vx + pm[7]*vy + pm[11]*vz + pm[15]*vw;

  if (cw <= 0) return { sx: 0, sy: 0, behind: true };

  return {
    sx: (cx / cw + 1) * width  / 2,
    sy: (1 - cy / cw)  * height / 2,
    behind: false,
  };
}

function updateLabels() {
  if (!cam) return;
  positionLabel(document.getElementById('axis-label-x'), 540, 0, 0);
  positionLabel(document.getElementById('axis-label-y'), 0, 540, 0);
  positionLabel(document.getElementById('axis-label-z'), 0, 0, 540);
  for (const s of STATE.speakers) {
    if (!s.enabled) continue;
    positionLabel(document.getElementById('speaker-label-' + s.id), s.x, s.y, s.z + 40);
  }

  // Phantom name labels — only when the phantoms layer is on; otherwise hide
  // (the label host stays in the DOM so re-enabling the layer resumes
  // immediately without resyncing).
  const showPhantoms = STATE.view.layers.phantoms;
  const phantomHost = document.getElementById('phantom-labels');
  if (phantomHost) phantomHost.style.display = showPhantoms ? '' : 'none';
  if (showPhantoms) {
    for (const p of STATE.phantoms) {
      // Smaller offset than speakers: phantom marker is r=16 vs speaker r=26,
      // so the label sits closer.
      positionLabel(document.getElementById('phantom-label-' + p.id), p.x, p.y, p.z + 28);
    }
  }

  const showCoords = STATE.view.layers.coords;
  const coordHost = document.getElementById('coord-labels');
  if (coordHost) coordHost.style.display = showCoords ? '' : 'none';
  if (showCoords) {
    updateCoordLabelTexts();
    for (const s of STATE.speakers) {
      const el = document.getElementById('coord-label-' + s.id);
      if (!el) continue;
      if (!s.enabled) { el.style.visibility = 'hidden'; continue; }
      // Place coord label below the speaker name (which sits at z+40).
      positionLabel(el, s.x, s.y, s.z - 30);
    }
    for (const p of STATE.phantoms) {
      const el = document.getElementById('coord-label-' + p.id);
      if (!el) continue;
      // Hide phantom coord labels when the phantom layer is off — the marker
      // they describe wouldn't be visible.
      if (!showPhantoms) { el.style.visibility = 'hidden'; continue; }
      positionLabel(el, p.x, p.y, p.z - 22);
    }
    positionLabel(document.getElementById('coord-label-origin'), 0, 0, 0);
    // Listening-centre coord label: only shown if its layer is on too —
    // otherwise the label would float at an invisible point.
    const centreEl = document.getElementById('coord-label-centre');
    if (centreEl) {
      if (STATE.view.layers['listening-centre']) {
        positionLabel(centreEl, 0, 0, STATE.audience.listeningHeight);
      } else {
        centreEl.style.visibility = 'hidden';
      }
    }
  }
}

function positionLabel(el, x, y, z) {
  if (!el) return;
  const proj = projectToScreen(x, y, z);
  if (!proj || proj.behind) {
    el.style.visibility = 'hidden';
    return;
  }
  el.style.visibility = '';
  el.style.left = proj.sx + 'px';
  el.style.top  = proj.sy + 'px';
}

// =============================================================================
// Panel event guards — when the pointer is over a floating function panel,
// dragging and wheel must not affect the 3D scene.
//
// Strategy: stop propagation in the bubbling phase on `document` for events
// whose target is inside a panel. p5 binds its mouse / wheel listeners on
// `window`, which sits above `document` in the bubble path, so document-
// level stopPropagation prevents p5 from ever seeing the event. The panel
// itself still receives the event in target / earlier-bubble phases, so
// scrollable panels (#disclaimer, #speakers-list) keep their default
// scroll behaviour. mouseup intentionally NOT blocked: a drag that started
// on the canvas and ends on a panel must still release p5's mouseIsPressed.
// =============================================================================

const PANEL_SELECTOR = '.panel, #disclaimer, #mobile-banner, #overlay-labels';

function pointerOnPanel(target) {
  return !!(target && target.closest && target.closest(PANEL_SELECTOR));
}

let _pointerCurrentlyOverPanel = false;
let _dragStartedOnPanel = false;

function allowCanvasInteraction() {
  // While a canvas-originated drag is in progress, allow orbit even if the
  // pointer crosses over a panel. Otherwise, suppress when over a panel.
  if (typeof mouseIsPressed !== 'undefined' && mouseIsPressed && !_dragStartedOnPanel) return true;
  if (_dragStartedOnPanel) return false;
  return !_pointerCurrentlyOverPanel;
}

function installPanelEventGuards() {
  document.addEventListener('mousemove', (e) => {
    _pointerCurrentlyOverPanel = pointerOnPanel(e.target);
  }, true);

  document.addEventListener('mousedown', (e) => {
    _dragStartedOnPanel = pointerOnPanel(e.target);
    if (_dragStartedOnPanel) e.stopPropagation();
  });

  document.addEventListener('mouseup', () => {
    _dragStartedOnPanel = false;
  }, true);

  document.addEventListener('wheel', (e) => {
    if (pointerOnPanel(e.target)) e.stopPropagation();
  }, { passive: true });
}

// =============================================================================
// Editor UI — speaker list, audience inputs, layout name, unit toggle.
// =============================================================================

// Speed of sound for delay estimates. Standard 343 m/s for ~20 °C dry air;
// the variation across realistic theatre temperatures (15–28 °C) is ≲ 1%,
// well below typical delay-alignment tolerance, so a fixed constant is
// honest enough for the "delay-line ballpark" use case.
const SPEED_OF_SOUND_MPS = 343;

// Update one speaker's distance / delay caption from the current STATE.
// Distance is the 3D Euclidean from speaker (s.x, s.y, s.z) to the listening
// centre (0, 0, listeningHeight); delay = distance / speed-of-sound.
function updateSpeakerDerived(s, el) {
  const dx = s.x;
  const dy = s.y;
  const dz = s.z - STATE.audience.listeningHeight;
  const cm = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const ms = (cm / 100 / SPEED_OF_SOUND_MPS) * 1000;
  const dist = STATE.view.unit === 'm'
    ? `${(cm / 100).toFixed(2)} m`
    : `${cm.toFixed(0)} cm`;
  el.textContent = `${dist} · ${ms.toFixed(1)} ms`;
}

// Refresh every visible speaker row's caption — used when a global input
// changes (listeningHeight moves, unit toggle flips).
function updateAllSpeakerDerived() {
  for (const item of document.querySelectorAll('.speaker-item')) {
    const id = item.dataset.id;
    const s = STATE.speakers.find(x => x.id === id);
    const el = item.querySelector('.speaker-derived');
    if (s && el) updateSpeakerDerived(s, el);
  }
}

const SPEAKER_FIELDS = [
  { key: 'x', label: 'X', kind: 'len',
    title: 'Right (+) / left (-) of listening centre' },
  { key: 'y', label: 'Y', kind: 'len',
    title: 'Forward (+) / back (-) of listening centre. +Y is toward the stage' },
  { key: 'z', label: 'Z', kind: 'len',
    title: 'Height above the audience floor (z = 0). Listening centre sits at z = listen height.' },
  { key: 'yaw', label: 'Yaw°', kind: 'angle',
    title: 'Horizontal aim. 0° = pointed at +Y (forward). +° rotates right (clockwise looking down)' },
  { key: 'pitch', label: 'Pitch°', kind: 'angle',
    title: 'Vertical aim. 0° = horizontal. +° tilts up' },
  { key: 'angleH', label: 'Spread H°', kind: 'angle',
    title: 'Horizontal dispersion — total angle (e.g. 90° for typical FOH cabinets). Spec-sheet angles usually cite the −6 dB point at ~2 kHz; LF coverage is broader.' },
  { key: 'angleV', label: 'Spread V°', kind: 'angle',
    title: 'Vertical dispersion — total angle. Spec-sheet angles usually cite the −6 dB point at ~2 kHz; LF coverage is broader.' },
];

function renderSpeakersList() {
  const list = document.getElementById('speakers-list');
  if (!list) return;
  list.innerHTML = '';
  for (const s of STATE.speakers) {
    list.appendChild(buildSpeakerItem(s));
  }
}

function buildSpeakerItem(s) {
  const li = document.createElement('li');
  li.className = 'speaker-item';
  li.dataset.id = s.id;

  // Header row
  const header = document.createElement('header');

  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = s.enabled;
  enabled.title = 'Enable / disable in calculations';
  enabled.addEventListener('change', () => {
    s.enabled = enabled.checked;
    markCoverageDirty();
    markTriangulationDirty();
  });

  const name = document.createElement('input');
  name.type = 'text';
  name.value = s.name;
  name.title = 'Speaker name';
  name.addEventListener('input', () => {
    s.name = name.value;
    const lab = document.getElementById('speaker-label-' + s.id);
    if (lab) lab.textContent = s.name;
    // Triangulation caches point names at compute time; without this the
    // triangle hover tooltip would keep showing the pre-rename name until
    // some other edit invalidates the cache.
    markTriangulationDirty();
  });

  const expandBtn = document.createElement('button');
  expandBtn.className = 'expand-btn';
  expandBtn.textContent = '▾';
  expandBtn.title = 'Expand / collapse fields';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '✕';
  deleteBtn.title = 'Delete speaker';
  deleteBtn.addEventListener('click', () => {
    if (!confirm(`Delete speaker "${s.name || '(unnamed)'}"?`)) return;
    STATE.speakers = STATE.speakers.filter(x => x.id !== s.id);
    syncSpeakerLabels();
    syncCoordLabels();
    renderSpeakersList();
    markCoverageDirty();
    markTriangulationDirty();
  });

  header.append(enabled, name, expandBtn, deleteBtn);
  li.appendChild(header);

  // Distance + delay caption. Always visible (one row per speaker, even when
  // collapsed) — sound designers scan this for delay-line alignment.
  const derived = document.createElement('div');
  derived.className = 'speaker-derived';
  derived.title = 'Distance from listening centre · estimated delay at 343 m/s (20 °C dry air)';
  updateSpeakerDerived(s, derived);
  li.appendChild(derived);

  // Editor body. Visibility is controlled by the .expanded class on `li`
  // (see CSS) — do NOT set the `hidden` attribute here, because the editor
  // has `display: grid` which overrides hidden's implicit display: none.
  const body = document.createElement('div');
  body.className = 'speaker-editor';

  for (const f of SPEAKER_FIELDS) {
    const fieldLabel = document.createElement('label');
    fieldLabel.className = 'field';
    if (f.title) fieldLabel.title = f.title;

    const span = document.createElement('span');
    span.textContent = f.label;

    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.dataset.field = f.key;
    inp.dataset.kind = f.kind;
    inp.value = f.kind === 'len' ? lenDisplay(s[f.key]) : s[f.key];
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      if (isNaN(v)) return;
      s[f.key] = f.kind === 'len' ? lenStore(v) : v;
      if (f.kind === 'len') updateSpeakerDerived(s, derived);
      markCoverageDirty();
      markTriangulationDirty();
    });

    fieldLabel.append(span, inp);
    body.appendChild(fieldLabel);
  }

  // Aim-at-centre button — fills yaw + pitch with the values that point this
  // speaker at the listening centre (0, 0, listeningHeight). User can override
  // afterwards.
  const aimBtn = document.createElement('button');
  aimBtn.type = 'button';
  aimBtn.className = 'aim-btn';
  aimBtn.textContent = '⊙ Aim at centre';
  aimBtn.title = 'Set Yaw and Pitch so this speaker points at the listening centre (0, 0, listen height)';
  aimBtn.addEventListener('click', () => {
    const aim = aimAtCentre(s.x, s.y, s.z);
    s.yaw   = aim.yaw;
    s.pitch = aim.pitch;
    const yawInp   = body.querySelector('input[data-field="yaw"]');
    const pitchInp = body.querySelector('input[data-field="pitch"]');
    if (yawInp)   yawInp.value   = aim.yaw;
    if (pitchInp) pitchInp.value = aim.pitch;
    markCoverageDirty();
    markTriangulationDirty();
  });
  body.appendChild(aimBtn);

  li.appendChild(body);

  expandBtn.addEventListener('click', () => {
    const expanded = li.classList.toggle('expanded');
    expandBtn.textContent = expanded ? '▴' : '▾';
    expandBtn.setAttribute('aria-expanded', String(expanded));
  });

  return li;
}

// =============================================================================
// Phantom list. Phantoms only carry x/y/z/name (SPEC §5.2) — no yaw/pitch/
// angle, no enabled flag (every phantom listed is "in" the triangulation).
// Item shape mirrors speaker items so the visual / interaction language is
// the same; the editor body just has 3 fields instead of 7.
// =============================================================================

const PHANTOM_FIELDS = [
  { key: 'x', label: 'X', kind: 'len',
    title: 'Right (+) / left (-) of listening centre' },
  { key: 'y', label: 'Y', kind: 'len',
    title: 'Forward (+) / back (-) of listening centre. +Y is toward the stage' },
  { key: 'z', label: 'Z', kind: 'len',
    title: 'Height above the audience floor (z = 0)' },
];

function renderPhantomsList() {
  const list = document.getElementById('phantoms-list');
  if (!list) return;
  list.innerHTML = '';
  for (const p of STATE.phantoms) {
    list.appendChild(buildPhantomItem(p));
  }
}

function buildPhantomItem(p) {
  const li = document.createElement('li');
  li.className = 'phantom-item';
  li.dataset.id = p.id;

  const header = document.createElement('header');

  const name = document.createElement('input');
  name.type = 'text';
  name.value = p.name;
  name.title = 'Phantom name';
  name.addEventListener('input', () => {
    p.name = name.value;
    const lab = document.getElementById('phantom-label-' + p.id);
    if (lab) lab.textContent = p.name;
    // Same cache-invalidation reason as speaker rename above.
    markTriangulationDirty();
  });

  const expandBtn = document.createElement('button');
  expandBtn.className = 'expand-btn';
  expandBtn.textContent = '▾';
  expandBtn.title = 'Expand / collapse fields';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '✕';
  deleteBtn.title = 'Delete phantom';
  deleteBtn.addEventListener('click', () => {
    if (!confirm(`Delete phantom "${p.name || '(unnamed)'}"?`)) return;
    STATE.phantoms = STATE.phantoms.filter(x => x.id !== p.id);
    syncPhantomLabels();
    syncCoordLabels();
    renderPhantomsList();
    markTriangulationDirty();
  });

  header.append(name, expandBtn, deleteBtn);
  li.appendChild(header);

  const body = document.createElement('div');
  body.className = 'phantom-editor';

  for (const f of PHANTOM_FIELDS) {
    const fieldLabel = document.createElement('label');
    fieldLabel.className = 'field';
    if (f.title) fieldLabel.title = f.title;

    const span = document.createElement('span');
    span.textContent = f.label;

    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.dataset.field = f.key;
    inp.dataset.kind = f.kind;
    inp.value = lenDisplay(p[f.key]);
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      if (isNaN(v)) return;
      p[f.key] = lenStore(v);
      markTriangulationDirty();
    });

    fieldLabel.append(span, inp);
    body.appendChild(fieldLabel);
  }

  li.appendChild(body);

  expandBtn.addEventListener('click', () => {
    const expanded = li.classList.toggle('expanded');
    expandBtn.textContent = expanded ? '▴' : '▾';
    expandBtn.setAttribute('aria-expanded', String(expanded));
  });

  return li;
}

function renderAudienceInputs() {
  for (const key of ['length', 'width', 'listeningHeight']) {
    const inp = document.querySelector(`input[data-audience="${key}"]`);
    if (inp) inp.value = lenDisplay(STATE.audience[key]);
  }
}

function renderLayoutName() {
  const inp = document.getElementById('layout-name');
  if (inp) inp.value = STATE.metadata.layoutName;
}

function renderUnitToggle() {
  document.querySelectorAll('#meta-panel button[data-unit]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.unit === STATE.view.unit);
  });
}

// On unit change, re-render all numeric inputs so displayed values match the
// new unit. Stored values stay in cm.
function refreshUnitInputs() {
  renderAudienceInputs();
  for (const item of document.querySelectorAll('.speaker-item')) {
    const id = item.dataset.id;
    const s = STATE.speakers.find(x => x.id === id);
    if (!s) continue;
    item.querySelectorAll('input[data-kind="len"]').forEach(inp => {
      inp.value = lenDisplay(s[inp.dataset.field]);
    });
  }
  for (const item of document.querySelectorAll('.phantom-item')) {
    const id = item.dataset.id;
    const p = STATE.phantoms.find(x => x.id === id);
    if (!p) continue;
    item.querySelectorAll('input[data-kind="len"]').forEach(inp => {
      inp.value = lenDisplay(p[inp.dataset.field]);
    });
  }
  // Distance / delay caption text depends on the displayed unit too.
  updateAllSpeakerDerived();
}

// =============================================================================
// Bulk paste (dev) — fast scenario seeding for testing. Parses every signed
// integer / float out of the textarea (commas / brackets / newlines / labels
// all ignored), groups in triplets as x/y/z. Trailing tokens that don't make
// a full triplet are dropped silently — caller sees the resulting speaker /
// phantom count via the rendered list. M4 will introduce full state import
// from a downloaded HTML file; this is the lighter-weight cousin for ad-hoc
// scenario testing during development.
// =============================================================================

function parseBulkTriplets(text) {
  const nums = (text.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const out = [];
  for (let i = 0; i + 2 < nums.length; i += 3) {
    out.push({ x: nums[i], y: nums[i + 1], z: nums[i + 2] });
  }
  return out;
}

function bulkReplaceSpeakers(text) {
  const trips = parseBulkTriplets(text);
  STATE.speakers = trips.map((t, i) => {
    const aim = aimAtCentre(t.x, t.y, t.z);
    return {
      id: nextSpeakerId(),
      name: 'Speaker ' + (i + 1),
      enabled: true,
      x: t.x, y: t.y, z: t.z,
      yaw: aim.yaw,
      pitch: aim.pitch,
      angleH: 90,
      angleV: 60,
    };
  });
  syncSpeakerLabels();
  syncCoordLabels();
  renderSpeakersList();
  markCoverageDirty();
  markTriangulationDirty();
}

function bulkReplacePhantoms(text) {
  const trips = parseBulkTriplets(text);
  STATE.phantoms = trips.map((t, i) => ({
    id: nextPhantomId(),
    name: 'Phantom ' + (i + 1),
    x: t.x, y: t.y, z: t.z,
  }));
  syncPhantomLabels();
  syncCoordLabels();
  renderPhantomsList();
  markTriangulationDirty();
}

// =============================================================================
// Full UI sync from STATE — runs on initial boot (always) and after the
// upload path replaces STATE (M4.C). Idempotent: every render* / sync*
// helper is safe to call repeatedly.
// =============================================================================

function syncUiFromState() {
  // Text inputs and unit toggle.
  renderLayoutName();
  renderUnitToggle();
  renderAudienceInputs();

  // Speaker / phantom rows + their world-space labels.
  renderSpeakersList();
  renderPhantomsList();
  syncSpeakerLabels();
  syncPhantomLabels();
  syncCoordLabels();

  // View preset button active state — mirrors STATE.view.cameraPreset.
  document.querySelectorAll('#view-controls button[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === STATE.view.cameraPreset);
  });

  // Layer checkboxes — mirror STATE.view.layers (default HTML attribute may
  // be stale after a state load).
  document.querySelectorAll('#layers-panel input[data-layer]').forEach(inp => {
    const k = inp.dataset.layer;
    if (k in STATE.view.layers) inp.checked = !!STATE.view.layers[k];
  });

  // Health-panel aside follows its own layer toggle.
  const healthEl = document.getElementById('health-panel');
  if (healthEl) healthEl.hidden = !STATE.view.layers['health-panel'];

  // Camera. Only safe after setup() — pre-setup, p5 globals like width /
  // height are 0 and camera() / perspective() throw. setup() runs its own
  // applyCamera() when cam is first assigned, so the initial-boot pass
  // intentionally skips this branch and the upload pass (M4.C) hits it.
  if (cam) applyCamera();

  updateAllSpeakerDerived();
  markCoverageDirty();
  markTriangulationDirty();
}

// =============================================================================
// PNG export (M4.A) — composite WEBGL canvas + HTML overlay labels into a
// 2× viewport PNG. The labels live in the DOM (because p5 WEBGL text() is
// unreliable, see ROADMAP discussion item 7), so we re-render them via 2D
// ctx.fillText using their computed font / colour. Panel UI and tooltips
// are intentionally excluded — the PNG should read as "the scene".
// =============================================================================

const PNG_EXPORT_SCALE = 2;
// Selectors for label elements that should appear in the PNG. Each spans
// inside #overlay-labels carries .overlay-label; axis labels are direct
// children with their own ids.
const PNG_LABEL_SELECTORS = [
  '#axis-label-x',
  '#axis-label-y',
  '#axis-label-z',
  '#speaker-labels > .overlay-label',
  '#phantom-labels > .overlay-label',
  '#coord-labels > .overlay-label',
].join(', ');

async function exportPng() {
  const scale = PNG_EXPORT_SCALE;
  const outW = Math.round(windowWidth * scale);
  const outH = Math.round(windowHeight * scale);

  // Ensure the WEBGL canvas reflects the very latest scene state and that
  // overlay labels are positioned for the same frame (updateLabels() runs
  // inside draw()). Synchronous redraw() means the framebuffer holds this
  // exact frame when we drawImage() below.
  if (typeof redraw === 'function') redraw();

  const scratch = document.createElement('canvas');
  scratch.width = outW;
  scratch.height = outH;
  const ctx = scratch.getContext('2d');

  // Match the WEBGL clear colour so labels with text-shadow halos blend.
  ctx.fillStyle = '#f3f3f6';
  ctx.fillRect(0, 0, outW, outH);

  const srcCanvas = document.querySelector('#canvas-host canvas');
  if (!srcCanvas) throw new Error('canvas not found');
  ctx.drawImage(srcCanvas, 0, 0, outW, outH);

  drawLabelsOntoExportCanvas(ctx, scale);

  const blob = await new Promise(resolve => scratch.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob returned null');

  const filename = pngFilename();
  triggerDownload(blob, filename);
}

function drawLabelsOntoExportCanvas(ctx, scale) {
  const labels = document.querySelectorAll(PNG_LABEL_SELECTORS);
  for (const el of labels) {
    const text = el.textContent;
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    // Parent host may be hidden when a layer is off (e.g. coords) — skip.
    const parent = el.parentElement;
    if (parent && getComputedStyle(parent).display === 'none') continue;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    // .overlay-label uses transform: translate(-50%,-50%), so the rect's
    // centre is the original anchor point. Draw text centred on that point.
    const cx = (rect.left + rect.width / 2) * scale;
    const cy = (rect.top + rect.height / 2) * scale;

    const sizePx = parseFloat(cs.fontSize) * scale;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${sizePx}px ${cs.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Approximate the multi-layer text-shadow halo (background-coloured)
    // with a single shadowBlur — enough to keep labels readable over the
    // heatmap without re-drawing the text six times.
    ctx.save();
    ctx.shadowColor = '#f3f3f6';
    ctx.shadowBlur = 4 * scale;
    ctx.fillStyle = '#f3f3f6';
    // Stamp the halo a few times to thicken it (single shadowBlur pass is
    // too subtle on busy heatmap pixels).
    for (let i = 0; i < 3; i++) ctx.fillText(text, cx, cy);
    ctx.restore();

    ctx.fillStyle = cs.color;
    ctx.fillText(text, cx, cy);
  }
}

function pngFilename() {
  const raw = (STATE.metadata.layoutName || '').trim();
  const safe = raw.replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'Untitled';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${safe}-coverage-${ts}.png`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been processed by the browser.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// =============================================================================
// HTML export (M4.B) — produce a self-contained HTML that opens with the
// current layout pre-loaded. Strategy:
//   1. Use the current document as the template (so the live tool and a
//      previously-downloaded copy share one code path; this also avoids a
//      fetch() that'd fail on file://).
//   2. Replace <link rel="stylesheet" href="coverage.css"> with an inline
//      <style id="coverage-style-inline"> on the first save, or update the
//      existing inline tag on subsequent saves.
//   3. Same trick for <script src="coverage.js"> → <script id="coverage-script-inline">.
//   4. Inject / update <script id="coverage-state" type="application/json">.
//   5. Prepend an HTML comment with metadata (SPEC §10.2) and set <title>.
// p5.js stays as an external CDN script — keeps the file small.
// =============================================================================

function serializeState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      layoutName: STATE.metadata.layoutName || '',
      createdAt: new Date().toISOString(),
      sourceUrl: SOURCE_URL,
      toolVersion: TOOL_VERSION,
    },
    audience: { ...STATE.audience },
    speakers: STATE.speakers.map(s => ({ ...s })),
    phantoms: STATE.phantoms.map(p => ({ ...p })),
    view: {
      unit: STATE.view.unit,
      cameraPreset: STATE.view.cameraPreset,
      layers: { ...STATE.view.layers },
    },
  };
}

async function getCoverageCss() {
  const inline = document.getElementById('coverage-style-inline');
  if (inline) return inline.textContent;
  const res = await fetch('coverage.css');
  if (!res.ok) throw new Error('coverage.css fetch failed: ' + res.status);
  return await res.text();
}

async function getCoverageJs() {
  const inline = document.getElementById('coverage-script-inline');
  if (inline) return inline.textContent;
  const res = await fetch('coverage.js');
  if (!res.ok) throw new Error('coverage.js fetch failed: ' + res.status);
  return await res.text();
}

// Selectors for elements whose contents are populated at runtime from STATE.
// Must be cleared in the cloned doc before serialization so the saved file
// boots from a clean slate (the embedded state drives re-population).
//
// #canvas-host is critical: p5's createCanvas() inserts a <canvas> child at
// runtime, and document.documentElement.outerHTML captures it. If we don't
// strip it, the saved file boots with the dead canvas already in DOM, p5
// adds a SECOND one, and the layout breaks (no scene renders).
const HTML_EXPORT_DYNAMIC_SELECTORS = [
  '#canvas-host',
  '#speaker-labels',
  '#phantom-labels',
  '#coord-labels',
  '#speakers-list',
  '#phantoms-list',
  '#health-panel-status',
];

async function buildSelfContainedHtml(state) {
  // Parse a clone of the current document so live mutations stay untouched.
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    '<!doctype html>' + document.documentElement.outerHTML,
    'text/html'
  );

  // Inline CSS — replace <link> on the first save, or update <style> on
  // subsequent saves of an already-downloaded file.
  const cssText = await getCoverageCss();
  const linkEl = doc.querySelector('link[rel="stylesheet"][href*="coverage.css"]');
  if (linkEl) {
    const styleEl = doc.createElement('style');
    styleEl.id = 'coverage-style-inline';
    styleEl.textContent = cssText;
    linkEl.replaceWith(styleEl);
  } else {
    const existing = doc.getElementById('coverage-style-inline');
    if (existing) existing.textContent = cssText;
  }

  // Inline JS.
  const jsText = await getCoverageJs();
  const srcScript = doc.querySelector('script[src*="coverage.js"]');
  if (srcScript) {
    const inlineScript = doc.createElement('script');
    inlineScript.id = 'coverage-script-inline';
    // defer is meaningless on inline scripts; drop it.
    inlineScript.textContent = jsText;
    srcScript.replaceWith(inlineScript);
  } else {
    const existing = doc.getElementById('coverage-script-inline');
    if (existing) existing.textContent = jsText;
  }

  // Embedded state script — escape '<' so the JSON can't accidentally close
  // the surrounding <script> tag. Critical: the state script must come
  // BEFORE the inline coverage.js script in document order, otherwise the
  // boot loader (an IIFE at module top) runs while state is not yet parsed
  // into the DOM and the saved layout won't apply.
  const stateJson = JSON.stringify(state, null, 2).replace(/</g, '\\u003c');
  let stateEl = doc.getElementById('coverage-state');
  if (!stateEl) {
    stateEl = doc.createElement('script');
    stateEl.id = 'coverage-state';
    stateEl.type = 'application/json';
    const inlineCoverage = doc.getElementById('coverage-script-inline');
    if (inlineCoverage && inlineCoverage.parentNode) {
      inlineCoverage.parentNode.insertBefore(stateEl, inlineCoverage);
    } else {
      doc.head.appendChild(stateEl);
    }
  }
  stateEl.textContent = stateJson;

  // Title.
  const layoutName = (state.metadata.layoutName || '').trim();
  const title = doc.querySelector('title');
  if (title) {
    title.textContent = layoutName || 'Sound Coverage Sketch — Untitled';
  }

  // Strip dynamic content so the saved file boots clean.
  for (const sel of HTML_EXPORT_DYNAMIC_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el) el.innerHTML = '';
  }
  // Reset bulk-paste textareas — these carry editor scratch text, not state.
  doc.querySelectorAll('textarea[data-bulk]').forEach(ta => { ta.value = ''; });
  // Reset disclaimer to expanded so the saved file always shows the framing.
  const disc = doc.getElementById('disclaimer');
  if (disc) disc.classList.remove('collapsed');
  const discToggle = doc.getElementById('disclaimer-toggle');
  if (discToggle) {
    discToggle.setAttribute('aria-expanded', 'true');
    const caret = discToggle.querySelector('.caret');
    if (caret) caret.textContent = '▴';
  }

  // Assemble final HTML with metadata comment header.
  const metaComment = buildMetadataComment(state);
  return '<!doctype html>\n'
    + metaComment
    + '\n'
    + doc.documentElement.outerHTML
    + '\n';
}

function buildMetadataComment(state) {
  const safe = s => String(s == null ? '' : s).replace(/--/g, '- -');
  const name = safe(state.metadata.layoutName) || '(untitled)';
  return [
    '<!--',
    '  Generated by Sound Coverage Sketch',
    '  Layout name: ' + name,
    '  Generated at: ' + safe(state.metadata.createdAt),
    '  Source: ' + safe(state.metadata.sourceUrl),
    '  Tool version: ' + safe(state.metadata.toolVersion),
    '',
    '  This file is fully editable.',
    '  Open it in a modern browser, or upload it back to the source URL to continue editing.',
    '-->',
  ].join('\n');
}

function htmlFilename() {
  const raw = (STATE.metadata.layoutName || '').trim();
  const safe = raw.replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
  return `${safe}-coverage-sketch.html`;
}

async function exportHtml() {
  const state = serializeState();
  const html = await buildSelfContainedHtml(state);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  triggerDownload(blob, htmlFilename());
}

// =============================================================================
// HTML import (M4.C) — accept a previously-saved file, parse out the embedded
// state, validate, apply. Failures throw with a user-readable message; the
// caller surfaces them via alert() and STATE is left untouched.
// applyLoadedState() throws BEFORE mutating STATE on the schemaVersion guard,
// so a bad-version file can never partially overwrite the current layout.
// =============================================================================

function extractEmbeddedState(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const stateEl = doc.getElementById('coverage-state');
  if (!stateEl) {
    throw new Error("Couldn't find an embedded layout in this file. Make sure it was saved by this tool.");
  }
  const text = (stateEl.textContent || '').trim();
  if (!text) {
    throw new Error('Embedded layout is empty.');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('Embedded layout is not valid JSON: ' + e.message);
  }
  return parsed;
}

async function importHtmlFile(file) {
  const text = await file.text();
  const parsed = extractEmbeddedState(text);
  applyLoadedState(parsed);
  syncUiFromState();
}

// Shared button-busy wrapper for the export buttons. Disables the button,
// swaps its label to "Saving…", runs the async fn, restores on completion.
async function runExport(btn, label, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    await fn();
  } catch (err) {
    console.error(label + ' failed:', err);
    alert(label + ' failed: ' + (err && err.message ? err.message : err));
  } finally {
    btn.textContent = originalLabel;
    btn.disabled = false;
  }
}

// =============================================================================
// UI wiring
// =============================================================================

window.addEventListener('DOMContentLoaded', () => {
  // View presets
  document.querySelectorAll('#view-controls button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#view-controls button[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.view.cameraPreset = btn.dataset.view;
      applyCamera();
    });
  });

  // Layer toggles
  document.querySelectorAll('#layers-panel input[data-layer]').forEach(inp => {
    inp.addEventListener('change', () => {
      const key = inp.dataset.layer;
      STATE.view.layers[key] = inp.checked;
      // health-panel is an HTML aside, not a 3D draw layer — toggle the
      // element's hidden attribute directly. (Other layers gate inside
      // drawScene each frame, so they don't need DOM updates here.)
      if (key === 'health-panel') {
        const el = document.getElementById('health-panel');
        if (el) el.hidden = !inp.checked;
      }
      // Layer-off → hide the corresponding tooltip immediately, don't wait
      // for the next mousemove.
      if (key === 'triangulation' && !inp.checked) {
        const tt = document.getElementById('triangle-tooltip');
        if (tt) tt.hidden = true;
        HOVER.lastTriIdx = -1;
      }
      if (key === 'speakers' && !inp.checked) {
        const tt = document.getElementById('speaker-tooltip');
        if (tt) tt.hidden = true;
        HOVER.speakerId = null;
      }
    });
  });

  // Initial visibility for the health-panel layer — the checkbox starts
  // checked per the layout in index.html, but we mirror that into the DOM
  // explicitly to handle any future default change in one place.
  const healthEl = document.getElementById('health-panel');
  if (healthEl) healthEl.hidden = !STATE.view.layers['health-panel'];

  // Layout name
  const nameInput = document.getElementById('layout-name');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      STATE.metadata.layoutName = nameInput.value;
    });
  }

  // Unit toggle
  document.querySelectorAll('#meta-panel button[data-unit]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.view.unit = btn.dataset.unit;
      renderUnitToggle();
      refreshUnitInputs();
    });
  });

  // Save PNG (M4.A) — disable button while exporting so a double-click
  // doesn't queue two downloads.
  const savePngBtn = document.getElementById('save-png-btn');
  if (savePngBtn) {
    savePngBtn.addEventListener('click', () => runExport(savePngBtn, 'PNG export', exportPng));
  }

  // Save HTML / Open HTML (M4.B / M4.C) — both are live-tool-only.
  // A downloaded HTML is a frozen snapshot: it can be viewed and locally
  // edited, but file I/O (re-saving, importing other layouts) belongs on
  // the live tool. Detection: presence of #coverage-script-inline.
  const isSnapshot = !!document.getElementById('coverage-script-inline');

  const saveHtmlBtn = document.getElementById('save-html-btn');
  if (saveHtmlBtn) {
    if (isSnapshot) {
      saveHtmlBtn.hidden = true;
    } else {
      saveHtmlBtn.addEventListener('click', () => runExport(saveHtmlBtn, 'HTML export', exportHtml));
    }
  }

  const openHtmlBtn = document.getElementById('open-html-btn');
  const openHtmlInput = document.getElementById('open-html-input');
  if (openHtmlBtn && openHtmlInput) {
    if (isSnapshot) {
      openHtmlBtn.hidden = true;
    } else {
      openHtmlBtn.addEventListener('click', () => openHtmlInput.click());
      openHtmlInput.addEventListener('change', async () => {
        const file = openHtmlInput.files && openHtmlInput.files[0];
        // Reset the input value first so picking the same file twice fires
        // change again. Done before await so an early return still resets.
        openHtmlInput.value = '';
        if (!file) return;
        try {
          await importHtmlFile(file);
        } catch (err) {
          console.error('HTML import failed:', err);
          alert('Open HTML failed:\n\n' + (err && err.message ? err.message : err));
        }
      });
    }
  }

  // Audience editor
  document.querySelectorAll('input[data-audience]').forEach(inp => {
    inp.addEventListener('input', () => {
      const key = inp.dataset.audience;
      const v = parseFloat(inp.value);
      if (isNaN(v)) return;
      STATE.audience[key] = lenStore(v);
      // Listening view depends on listeningHeight — refresh if active.
      if (key === 'listeningHeight' && STATE.view.cameraPreset === 'listening') {
        applyCamera();
      }
      // listeningHeight moves the centre → every speaker's distance changes.
      if (key === 'listeningHeight') updateAllSpeakerDerived();
      markCoverageDirty();
      markTriangulationDirty();
    });
  });

  // Add Speaker — defaults to a sensible position 200cm in front of the
  // audience front edge at 240cm height, with yaw/pitch auto-aimed at centre.
  const addBtn = document.getElementById('add-speaker-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const x = 0;
      const y = STATE.audience.width / 2 + 200;  // 200cm beyond audience front edge (+Y)
      const z = 240;
      const aim = aimAtCentre(x, y, z);
      const newSpeaker = {
        id: nextSpeakerId(),
        name: 'Speaker ' + (STATE.speakers.length + 1),
        enabled: true,
        x, y, z,
        yaw: aim.yaw,
        pitch: aim.pitch,
        angleH: 90,
        angleV: 60,
      };
      STATE.speakers.push(newSpeaker);
      syncSpeakerLabels();
      syncCoordLabels();
      renderSpeakersList();
      markCoverageDirty();
      markTriangulationDirty();
    });
  }

  // Add Phantom — defaults to (0, 0, 250cm) i.e. straight up from the
  // listening centre. This is the canonical Spat / Panoramix "phantom at
  // zenith" placement, which is the most common reason a sound designer
  // adds a phantom in the first place. User can edit afterwards.
  const addPhantomBtn = document.getElementById('add-phantom-btn');
  if (addPhantomBtn) {
    addPhantomBtn.addEventListener('click', () => {
      const newPhantom = {
        id: nextPhantomId(),
        name: 'Phantom ' + (STATE.phantoms.length + 1),
        x: 0,
        y: 0,
        z: 250,
      };
      STATE.phantoms.push(newPhantom);
      syncPhantomLabels();
      syncCoordLabels();
      renderPhantomsList();
      markTriangulationDirty();
    });
  }

  // Bulk paste buttons (dev affordance) — both Speaker and Phantom panels
  // share the same data-bulk-go / data-bulk attribute pattern.
  document.querySelectorAll('button[data-bulk-go]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.bulkGo;
      const ta = document.querySelector(`textarea[data-bulk="${target}"]`);
      if (!ta) return;
      if (target === 'speakers') bulkReplaceSpeakers(ta.value);
      else if (target === 'phantoms') bulkReplacePhantoms(ta.value);
    });
  });

  // Initial renders. Calling syncUiFromState() also handles the post-load
  // case (M4.B boot loader, M4.C upload) where STATE has been replaced and
  // every input / checkbox / camera button needs to be re-derived.
  syncUiFromState();

  // Disclaimer collapse toggle (header always visible, body folds away).
  const disclaimer = document.getElementById('disclaimer');
  const disclaimerToggle = document.getElementById('disclaimer-toggle');
  if (disclaimer && disclaimerToggle) {
    disclaimerToggle.addEventListener('click', () => {
      const collapsed = disclaimer.classList.toggle('collapsed');
      disclaimerToggle.querySelector('.caret').textContent = collapsed ? '▾' : '▴';
      disclaimerToggle.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  // Mobile banner (SPEC §13). Session-scoped dismiss: once the user
  // hits ✕ the banner stays away until reload, even if they resize
  // back and forth across the 1024px threshold. Reload re-evaluates
  // afresh — there is no localStorage involvement on purpose.
  const banner = document.getElementById('mobile-banner');
  if (banner) {
    let dismissed = false;
    const updateBanner = () => {
      banner.hidden = dismissed || window.innerWidth >= 1024;
    };
    updateBanner();
    window.addEventListener('resize', updateBanner);
    document.getElementById('mobile-banner-dismiss').addEventListener('click', () => {
      dismissed = true;
      banner.hidden = true;
    });
  }
});
