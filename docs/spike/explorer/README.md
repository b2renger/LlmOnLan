# Capacity explorer

An interactive page to choose hardware and a model: for each model × hardware pair at a chosen context per
person, it shows how many people at once, how fast for one person, the price per person, the first word on a new
document, and the longest context. Clicking a pair opens its memory split, its speed as people join (with the
measured points where they exist) and its people-vs-context curve. Every figure is labelled **measured**,
**calibrated** (a measured model scaled to another box) or **estimated** (from the specs).

Published as a private Artifact: https://claude.ai/artifact/5voKHTLBktJuUpf9CLk9jt (2026-10-07).

## Files

| File | What it is |
|---|---|
| `explorer.src.html` | The page, with three placeholders for the data. |
| `build_page.js` | `node build_page.js` inlines `catalog.json`, a trimmed `measured.json` and `estimator.js` into `explorer.html` (one self-contained file, ~300 KB; generated, not committed). |
| `estimator.js` | The model: KV pages and recurrent state as vLLM 0.30 charges them, a decode step-time fit scaled by memory bandwidth, prefill scaled by compute, two Sparks as copies or tensor-parallel over ConnectX-7. Every assumption is named in `ASSUME` and the page can override the main ones. |
| `measured.json`, `measured-summary.md` | Every measured point from `docs/spike/results/` (both boxes), built by `build_measured.py` (+ `crosscheck.py` against RESULTS.md, `write_summary.py`). |
| `catalog.json`, `catalog-sources.md` | 10 hardware entries and 29 models (sizes, attention layout, checkpoints, prices, benchmark scores, community speed reports), with sources and dates. Built by `build_catalog.py` from curated facts plus Hugging Face API dumps that are not kept here (re-fetch to rebuild). |
| `calibrate/` | `python calibrate/extract.py`, then `node calibrate/calibrate.js` (fits the constants, which are copied by hand into `estimator.js`), `node calibrate/validate.js` (writes `validation_tables.md`) and `node calibrate/test_cases.js`. |

## How far to trust it

- **Validated out of sample.** Calibrated on the RTX PRO 6000 alone, the estimator predicted the DGX Spark's
  measured people within the measured range in **17 of 18** cells (mean error 1 %, worst 14 %).
  - Caveat: the GB10 prefill factor and the per-model extra bytes use one Spark measurement each.
- **Two linked Sparks are not measured.**
  - The per-layer exchange delay (55 µs) is fitted to two community reports, and the page lets you change it.
  - Measure the pair once they are cabled, then re-calibrate.
- **Not modelled:**
  - speculative decoding;
  - sparse attention, so long-context figures are pessimistic for GLM-5.3, DeepSeek-V4 and MiniMax-M3;
  - llama.cpp's weaker batching (it served 2–24× fewer people in the spike);
  - people pausing to read.
- **Quality** is the vendors' benchmarks, except the spike's own 28-question check for the three measured models.

## Updating

When a new box or model is measured, re-run the spike's harness (`docs/spike/README.md`), then:
1. Rebuild `measured.json` with `build_measured.py`.
2. Re-run `calibrate/`.
3. Copy the new constants into `estimator.js`.
4. Run `node build_page.js`.
5. Republish the page to the same Artifact link.
