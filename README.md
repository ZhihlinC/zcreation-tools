# Sound Coverage Sketch

A small browser-based tool for sound designers — sketch multichannel speaker layouts in 3D, see their geometric coverage, and get VBAP-family layout health hints, without a CAD pipeline.

→ **Live**: <https://tools.zcreation.art/coverage/>

![Coverage view of a 32-channel dome layout](site/og-image.png)

## What it does

- **3D speaker layout** with cone visualisation from manufacturer dispersion angles
- **Audience-plane coverage heatmap** showing how many speakers reach each listener position
- **Pulkki-VBAP triangulation** with per-triangle health flags (max angle, area uniformity, L/R symmetry)
- **Phantom speakers** to reserve panning positions on the sphere that aren't physical speakers (e.g. closing the hull above or below the listeners)
- **Save / Open as a single self-contained HTML file** — your layout travels with its viewer; share it like any other file
- **English UI** (sound-design vocabulary stays English by convention); the §2 scope disclaimer is bilingual zh-TW / EN

## What it isn't

It is a **geometric sketch**, not an acoustic simulation: it does not predict SPL, frequency response, reflections or phase, and it does not model any renderer's behaviour. It is meant to help with two questions:

1. Is your imagined listening centre actually covered by the speakers you've placed?
2. Geometrically, is your multichannel layout healthy for VBAP-family panners?

How it actually sounds is still up to your renderer and your ears. See [SPEC.md §2](./SPEC.md) for the full positioning statement.

## Why this exists

Theatre, live, and experimental sound designers rarely have a CAD pipeline for sketching speaker positions before a show. This tool exists to skip that barrier — drag-and-tweak a layout in a browser, see coverage, save the HTML, share it. No login, no accounts, no cloud.

Built and maintained by [Zhih-Lin Chen](https://zcreation.art) alongside a July 2026 QLab multichannel workshop.

## Stack

- Vanilla HTML + JavaScript + [p5.js](https://p5js.org/) (CDN). No build pipeline, no framework, no npm install.
- Self-contained downloads: every saved layout is a single HTML file with the editing UI inlined.
- Hosted on Cloudflare Pages; only the `site/` folder is published.
- Design spec: [SPEC.md](./SPEC.md) (Chinese body with English headings + key terms — the spec is the single source of truth and contains the full standards-alignment caveats).

## Development

The published site is `site/` (serve it locally with `cd site && python3 -m http.server 8000`). Tests live in `tests/`, one folder per tool, each installed with `npm ci && npx playwright install chromium`:

- [`tests/coverage/README.md`](tests/coverage/README.md) — Sound Coverage Sketch regression tests
- [`tests/pdf/README.md`](tests/pdf/README.md) — PDF page tool: usage notes, tests and library upgrades

## Feedback (beta)

This is in **v1.1.0-beta**. If a sketched layout surprises you — health panel warns about something it shouldn't, or misses something it should, or wording is confusing — please [open an issue](../../issues). Beta feedback shapes v1.

Known scope limits (intentional, see [SPEC §16](./SPEC.md)):

- No SPL / loudness / frequency-response prediction (the tool shows distance and propagation delay; the rest is your domain)
- No layout preset library (5.1 / 7.1 / Octagon templates, etc.) — the workflow is "draw what you need", not "load a standard and adjust"
- No mobile-optimised editing (desktop-first; below 1024px only the 3D view is shown, with a banner saying so)

## License

[MIT](./LICENSE).
