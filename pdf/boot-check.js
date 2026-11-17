// app.js is a module: if it (or pdf.js) fails to load, nothing else would say so.
// A separate file, not inline, so the page works under the /pdf/* CSP.
window.addEventListener('load', function () {
  setTimeout(function () {
    if (!window.__pdfTool) document.getElementById('load-failed').hidden = false;
  }, 1500);
});
