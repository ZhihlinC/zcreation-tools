// Shared test helper: what did a PDF page actually draw? Walks a pdf.js
// operator list tracking the CTM, and returns every path drawn after the
// page's original (q…Q-wrapped) content, with its bbox in user space and the
// colours / line width in effect.
'use strict';
function drawnPaths(pdfjs, ol) {
  const OPS_NAME = Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]));
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0], depth = 0, originalDone = false;
  let st = { fill: null, stroke: null, lw: 1 };
  const stack = [];
  const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  ol.fnArray.forEach((fn, i) => {
    const op = OPS_NAME[fn], a = ol.argsArray[i];
    if (op === 'save') { stack.push([ctm, Object.assign({}, st)]); depth++; }
    else if (op === 'restore') { [ctm, st] = stack.pop(); depth--; if (depth === 0) originalDone = true; }
    else if (op === 'transform') ctm = mul(a, ctm);
    else if (op === 'setFillRGBColor') st.fill = a[0];
    else if (op === 'setStrokeRGBColor') st.stroke = a[0];
    else if (op === 'setLineWidth') st.lw = a[0];
    else if (op === 'constructPath' && originalDone) {
      const mm = Array.from(a[2]);
      const pts = [ap(ctm, mm[0], mm[1]), ap(ctm, mm[2], mm[3]), ap(ctm, mm[0], mm[3]), ap(ctm, mm[2], mm[1])];
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const kind = pdfjs.OPS.fill === a[0] || pdfjs.OPS.eoFill === a[0] ? 'fill'
        : pdfjs.OPS.stroke === a[0] || pdfjs.OPS.closeStroke === a[0] ? 'stroke' : 'fillStroke';
      out.push({ bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], kind, fill: st.fill, stroke: st.stroke, lw: st.lw });
    }
  });
  return out;
}

module.exports = { drawnPaths };
