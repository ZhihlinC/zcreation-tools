// Background thread for the pdf-lib work that would freeze the page on big
// files: the upload check (parse + page count) and assembling the download.
// Messages: { id, op: 'count', bytes } → { id, count }
//           { id, op: 'assemble', sources, pages, paper? } → { id, bytes }
// Errors come back as { id, error } with the original message.
/* global PDFLib, PdfAssemble */
importScripts('vendor/pdf-lib.min.js', 'assemble.js');

self.onmessage = async e => {
  const { id, op } = e.data;
  try {
    if (op === 'count') {
      const doc = await PDFLib.PDFDocument.load(e.data.bytes);
      self.postMessage({ id, count: doc.getPageCount() });
    } else if (op === 'assemble') {
      const bytes = await PdfAssemble.assemble(PDFLib, e.data.sources, e.data.pages, { paper: e.data.paper });
      self.postMessage({ id, bytes }, [bytes.buffer]);
    } else {
      throw new Error('unknown op ' + op);
    }
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) || String(err) });
  }
};
