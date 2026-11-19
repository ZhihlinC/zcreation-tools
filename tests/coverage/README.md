# Coverage tool — regression tests

```bash
cd tests/coverage && npm ci && npx playwright install chromium
npm test                 # Node: triangulation dev tests + fix checks (no browser)
cd site && python3 -m http.server 8000   # from the repo root: open http://localhost:8000/coverage/
```

The tool itself lives in `site/coverage/`. These scripts load it from there.

| Command | What it runs |
| --- | --- |
| `npm test` | `test-fixes-node.js`: runs `__triangulationDevTests()` and the fix checks on the pure functions, through `load-coverage.js` (a Node `vm` with no p5 and no DOM, so the computational code must not depend on p5) |
| `npm run test:browser` | `test-fixes-browser.js` (Add Speaker / Add Phantom forms, validation, labels, camera limits, 2× PNG, Save / Open HTML, offline notice, Atmos demo hull-open, mobile banner) and `roundtrip.js` (save → reopen round trip, prints a report) |
| `npm run mutation` | `mutation-check.js`: breaks each fix in a temporary copy (repo files are never touched) and checks that the Node tests fail |
| `npm run mutation:browser` | the same, including the browser-suite mutations (a few minutes each, 3 in parallel) |
| `node regenerate-demos.js` | re-saves `site/demo/*.html` with the current `coverage.js` (Open HTML → Save HTML) and checks the layout data is unchanged; run it after editing `coverage.js`, because the demos embed the tool |

Notes:

- p5 comes from `node_modules/p5` (pinned to the version the page loads from its CDN); the browser tests route the CDN URL to that file, so they run without network access. Set `P5_LOCAL` to use another copy.
- Chromium is launched with a UTF-8 locale (so non-ASCII download names survive) and with `--use-mock-keychain --password-store=basic`.
- Headless Chromium renders WebGL in software at a few fps, so the camera-limit check places the camera out of range and lets the next frame clamp it instead of scrolling.
- Playwright is pinned to the same version here and in `tests/pdf`; bump both together.
