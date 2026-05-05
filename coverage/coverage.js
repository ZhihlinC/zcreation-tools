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
      phantoms: true, 'health-panel': false,
    },
  },
};

let _speakerCounter = STATE.speakers.length + 1;
function nextSpeakerId() { return 's' + (_speakerCounter++); }

let _phantomCounter = STATE.phantoms.length + 1;
function nextPhantomId() { return 'p' + (_phantomCounter++); }

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

  if (points.length < 4) {
    return { kind: 'too-few', count: points.length };
  }

  // Find the most numerically stable plane-normal candidate.
  let nx = 0, ny = 0, nz = 0, bestMag = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i].dir;
    for (let j = i + 1; j < points.length; j++) {
      const b = points[j].dir;
      const cx = a.y * b.z - a.z * b.y;
      const cy = a.z * b.x - a.x * b.z;
      const cz = a.x * b.y - a.y * b.x;
      const m2 = cx*cx + cy*cy + cz*cz;
      if (m2 > bestMag * bestMag) {
        bestMag = Math.sqrt(m2);
        nx = cx / bestMag;
        ny = cy / bestMag;
        nz = cz / bestMag;
      }
    }
  }

  if (bestMag < COLLINEAR_EPS) {
    return { kind: 'collinear', count: points.length };
  }

  let maxDeviation = 0;
  for (const p of points) {
    const d = Math.abs(p.dir.x * nx + p.dir.y * ny + p.dir.z * nz);
    if (d > maxDeviation) maxDeviation = d;
  }

  if (maxDeviation < PLANAR_EPS) {
    // Build an in-plane basis {u, v}. u = first direction (it lies in the
    // plane by construction since dot(u, n̂) ≈ 0). v = n̂ × u, also in plane.
    // Each point's azimuth in the plane = atan2(dot(d, v), dot(d, u)).
    const u = points[0].dir;
    const vx = ny * u.z - nz * u.y;
    const vy = nz * u.x - nx * u.z;
    const vz = nx * u.y - ny * u.x;
    const azimuth = (d) => Math.atan2(
      d.x * vx + d.y * vy + d.z * vz,
      d.x * u.x + d.y * u.y + d.z * u.z,
    );
    const sorted = points.slice().sort((p, q) => azimuth(p.dir) - azimuth(q.dir));
    return {
      kind: 'planar',
      points: sorted,
      normal: { x: nx, y: ny, z: nz },
    };
  }

  return { kind: 'ok', points };
}

function triangulationStatusText(r) {
  if (!r) return '';
  switch (r.kind) {
    case 'too-few':
      return `Add ≥ 4 enabled speakers or phantoms to enable triangulation. Currently: ${r.count}.`;
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
      return `Speakers are collinear from the listening centre — layout needs spatial spread.`;
    case 'planar':
      return `Planar layout — 2D ring shown in place of triangulation (${r.points.length} points).`;
    case 'ok':
      return `3D layout — ${r.points.length} points. (Hull rendering pending — M3.B next phase.)`;
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
}

function drawTriangulation() {
  const r = TRIANGULATION.result;
  if (!r || r.kind !== 'planar') return;
  // Caller (drawScene) already disabled DEPTH_TEST for this pass.
  push();
  noFill();
  // Muted purple — harmonises with the phantom violet but darker, so it
  // reads as "structural overlay" rather than "another speaker marker".
  stroke(95, 70, 145, 220);
  strokeWeight(1.5);
  beginShape();
  for (const p of r.points) vertex(p.pos.x, p.pos.y, p.pos.z);
  endShape(CLOSE);
  pop();
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

  // 4. Tetrahedron — genuinely 3D, should be 'ok'.
  setLayout([
    { x: 200, y: 200, z: 240 }, { x: -200, y: 200, z: 240 },
    { x: 0, y: -200, z: 240 }, { x: 0, y: 0, z: 60 },
  ]);
  r = analyseTriangulation();
  check('ok-tetrahedron', r.kind === 'ok' && r.points.length === 4, r);

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

  // 7. Collinear directions (all on the +X / −X line from listening centre).
  setLayout([
    { x: 100, y: 0, z: 120 }, { x: 200, y: 0, z: 120 },
    { x: 300, y: 0, z: 120 }, { x: -100, y: 0, z: 120 },
  ]);
  r = analyseTriangulation();
  check('collinear-on-x-axis', r.kind === 'collinear', r);

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
  // now-orphaned old canvas.
  setAttributes('antialias', true);
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
  fill(110, 122, 150);
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
    title: 'Horizontal dispersion — total angle (e.g. 90° for typical FOH cabinets)' },
  { key: 'angleV', label: 'Spread V°', kind: 'angle',
    title: 'Vertical dispersion — total angle' },
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
      STATE.view.layers[inp.dataset.layer] = inp.checked;
    });
  });

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

  // Initial renders
  renderLayoutName();
  renderUnitToggle();
  renderAudienceInputs();
  renderSpeakersList();
  renderPhantomsList();
  // Populate the triangulation status caption from the default LCR layout.
  // markTriangulationDirty() schedules a setTimeout(0) recompute + DOM write,
  // so by the time the user can see anything the caption is correct.
  markTriangulationDirty();

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

  // Mobile banner
  if (window.innerWidth < 1024) {
    const banner = document.getElementById('mobile-banner');
    banner.hidden = false;
    document.getElementById('mobile-banner-dismiss').addEventListener('click', () => {
      banner.hidden = true;
    });
  }
});
