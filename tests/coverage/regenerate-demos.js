// Re-save the repo demos with the current coverage.js (they embed a copy of
// the tool). For each demo: open the live tool, "Open HTML" the demo, "Save
// HTML", and write the download back over the demo file. Layout data is
// carried over exactly (checked below); only the embedded tool code, the
// generated-at timestamp and the metadata comment change.
// Usage: P5_LOCAL=/path/to/p5.min.js node regenerate-demos.js
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { serve, newPage, ready, launch, ROOT } = require('./browser-helpers');

const DEMOS = ['demo/Dolby-Atmos-7.1.4-coverage-sketch.html', 'demo/12ch-Pentakis-Dome-coverage-sketch.html'];
const stateOf = html => JSON.parse(/<script id="coverage-state" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1].replace(/\\u003c/g, '<'));
const strip = st => { const c = JSON.parse(JSON.stringify(st)); delete c.metadata.createdAt; delete c.metadata.toolVersion; delete c.view.camera; return c; };

(async () => {
  const srv = await serve();
  const browser = await launch(chromium);
  for (const rel of DEMOS) {
    const file = path.join(ROOT, rel);
    const oldHtml = fs.readFileSync(file, 'utf8');
    const page = await newPage(browser);
    await page.goto(`http://127.0.0.1:${srv.address().port}/coverage/`);
    await ready(page);
    const before = stateOf(oldHtml);
    await page.setInputFiles('#open-html-input', file);
    await page.waitForFunction(n => STATE.metadata.layoutName === n, before.metadata.layoutName);
    await page.waitForTimeout(300);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save-html-btn')]);
    const tmp = path.join(path.dirname(file), '.regen-' + path.basename(file));
    await dl.saveAs(tmp);
    const newHtml = fs.readFileSync(tmp, 'utf8');
    const same = JSON.stringify(strip(before)) === JSON.stringify(strip(stateOf(newHtml)));
    const nameOk = dl.suggestedFilename() === path.basename(file);
    if (!same || !nameOk || page.__errors.length) {
      fs.unlinkSync(tmp);
      throw new Error(`${rel}: state same=${same} filename=${dl.suggestedFilename()} errors=${page.__errors}`);
    }
    fs.renameSync(tmp, file);
    console.log(`${rel}: regenerated (${(newHtml.length / 1024).toFixed(0)} KB), layout state identical, filename ${dl.suggestedFilename()}`);
    await page.context().close();
  }
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
