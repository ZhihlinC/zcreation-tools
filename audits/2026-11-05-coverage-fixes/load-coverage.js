// Load coverage/coverage.js into a Node vm context (no p5, no DOM) so the
// pure functions can be tested directly. COVERAGE_JS_OVERRIDE points at an
// alternative source file (used by mutation-check.js).
//
// Unlike the 2026-11-05 audit loader, NO `radians` stub is provided: the
// computational code must not depend on p5 globals (audit F-10 — the panels
// and Layout Health have to work when p5 failed to load).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = () => process.env.COVERAGE_JS_OVERRIDE || path.join(__dirname, '../../coverage/coverage.js');

// opts.embeddedStateJson: text for a fake <script id="coverage-state"> so the
// boot-time loader (what a saved file runs on open) can be exercised.
function loadCoverage(opts = {}) {
  const src = fs.readFileSync(SRC(), 'utf8');
  const noop = () => {};
  const warnings = [];
  const stateEl = opts.embeddedStateJson == null ? null : { textContent: opts.embeddedStateJson };
  const ctx = {
    console: { ...console, warn: (...a) => warnings.push(a.map(String).join(' ')) },
    setTimeout: noop,
    Math, JSON, Number, Array, Object, Map, Set, Error, Uint8Array, String, parseFloat, parseInt, isNaN,
    document: { getElementById: (id) => (id === 'coverage-state' ? stateEl : null), querySelectorAll: () => [], querySelector: () => null },
    window: { addEventListener: noop },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'coverage.js' });
  vm.runInContext(`globalThis.__api = {
    STATE, COVERAGE, TRIANGULATION, analyseTriangulation, computeCoverage, speakerBasis,
    speakerForward, coneCorners, aimAtCentre, applyLoadedState, composeHealthLines,
    triangulationStatusText, assertManifoldOrThrow, buildSphericalHull, premergeSlivers,
    lenDisplay, lenStore, htmlFilename, pngFilename, __triangulationDevTests,
    makeDefaultState, serializeState, escapeInlineScript, escapeInlineStyle,
    clampCameraEye, CAMERA_DISTANCE_LIMITS, regionForDirection, dominantRegion,
    isValidFinite, isValidAudienceValue, isValidSpread, validatorForField,
    filenameStem, buildMetadataComment, layoutTitle,
    HEALTH: { HEALTH_ANGLE_YELLOW, HEALTH_ANGLE_RED, HEALTH_RATIO_YELLOW, HEALTH_RATIO_RED,
              SYMMETRY_DELTA_YELLOW, SYMMETRY_DELTA_RED, PLANAR_ELEVATION_DEG, ENCLOSE_EPS },
  };`, ctx);
  ctx.__api.bootWarnings = warnings;
  // Replace a top-level function inside the context (fault injection).
  ctx.__api.__override = (name, fn) => { ctx.__tmp = fn; vm.runInContext(`${name} = globalThis.__tmp;`, ctx); };
  return ctx.__api;
}
module.exports = { loadCoverage };
