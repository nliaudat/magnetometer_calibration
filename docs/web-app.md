# Web app

A dependency-free browser version of this tool, published with GitHub Pages:

**<https://nliaudat.github.io/magnetometer_calibration/>**

Drop in a raw capture, read the quality report, and copy the C code / JSON / ESPHome lambda, or
download the patched YAML. Everything - parsing, the ellipsoid fit, the diagnostics, the plots -
happens in your browser; **the capture is never uploaded**.

The port answers the same question as the CLI, so the two are kept numerically comparable:
`tools/dump_golden.py` asks the Python implementation for its answers and `web/tests/spec.js`
checks the JavaScript against them.

## How to open it (locally)

**Do not double-click `index.html`.** The app is an ES module, and browsers block module loading
and `fetch()` for `file://` pages, so a double-clicked page renders but every button is dead.

| | Command | Notes |
| --- | --- | --- |
| easiest | `python tools/serve.py --open` | builds `site/`, serves the repository root and prints every URL |
| manual | `python -m http.server 8765`, then open <http://localhost:8765/web/> | the server root must be the **repository** root; a server rooted inside `web/` cannot reach `../mag_out_sample.txt` |
| no server at all | open `site/magcal.html` after a build | one self-contained file - modules inlined, sample embedded - which *does* work by double-clicking |

| Symptom | Cause |
| --- | --- |
| the page renders, nothing reacts, console shows *Access to script … has been blocked by CORS policy* | it was opened from `file://` |
| a "Serve this page over HTTP" panel instead of the app | the same thing, reported instead of silent |
| "could not load the sample capture" over HTTP | the server root is `web/`, so `../mag_out_sample.txt` is unreachable |

## What it does

| Step | Same as the CLI |
| --- | --- |
| read a capture | comma / semicolon / tab / whitespace separated rows, a header naming `x`,`y`,`z` (and the unit, e.g. `mag_x_uT`), raw ESPHome/serial log lines, or an `extract pattern` regex |
| filter | `min-delta` (drop parked samples) and `max-points` |
| fit | Li & Griffiths ellipsoid fit (`k = 4`), hard iron `b`, soft iron `A_1 = F/√k · sqrtm(M)` |
| score | the `\|B\|` residual against `field`, the coverage ratio, the CLI's warnings and PASS/FAIL verdict |
| export | the C code block, the four-key JSON block, the ESPHome lambda (with declination), a calibrated CSV and a JSON record in the CLI's schema v2 |
| patch | `esphome_code.yaml` with the twelve constants replaced (all-or-nothing) |

## Quick start (locally)

```bash
python tools/build_site.py            # assembles site/ (app + tests + sample capture)
python tools/run_web_tests.py --page /site/index.html --grep 'data-app=.ready.'
python -m http.server 8765            # then open http://localhost:8765/site/
```

Without the build step you can serve the repository root and open `http://localhost:8765/web/`
(the app falls back to `../mag_out_sample.txt` for its sample capture).

## Choosing the expected field

`A_1 = F/√k · sqrtm(M)` is **proportional to the expected field `F`**, while the hard iron bias does
not depend on it at all. Two consequences worth knowing:

* **the calibration quality cannot detect a wrong `F`.** The fit rescales itself, so the `|B|`
  residual is the same whatever you enter and the report still says PASS — only the *magnitude* of
  the corrected vector ends up wrong (the heading is unaffected, which is why a compass-only use
  case tolerates a rough value, but tilt compensation and any vector consumer do not);
* **the bundled sample was recorded at 515 µT.** *Load the sample capture* fills the field in for
  you; the README and the tests use 515. Your own value goes in
  [gravitation-field.md](gravitation-field.md).

What the trap looks like, using the bundled capture with `--field 1000` instead of `515`:

| | 515 µT | 1000 µT | ratio |
| --- | --- | --- | --- |
| `soft_iron_bias_xx` | 2.711938 | 5.265898 | 1.941748 = 1000/515 |
| `hard_iron_bias_z` | 569.663929 | 569.663932 | 1 |
| residual `\|B\|` | 0.6475 % | 0.6475 % | 1 |
| calibrated `\|B\|` mean | 514.99 | 999.98 | 1.9417 |

Every soft-iron entry is off by the same factor and the report is none the wiser - that is why the
app prefills the field when it loads the sample, shows which field it used next to the quality
badge, and why a high `error %` cannot be caused by a wrong `--field` at all: `F` cancels out of
that metric.

## File map

| Path | Responsibility |
| --- | --- |
| `web/index.html`, `web/app.js`, `web/style.css` | the app shell, its wiring and styling |
| `web/js/linalg.js` | dense linear algebra: LU/Gauss inverse, triangular solves, Cholesky, Jacobi symmetric eigen decomposition, symmetric square root |
| `web/js/fit.js` | the ellipsoid fit, its guards and their messages (the `_ellipsoid_fit` / `calibrate` of `calibrate.py`) |
| `web/js/diagnostics.js` | residual/coverage metrics, heading statistics, text reports (the CLI has no quality report; the metric is what `tools/dump_golden.py` computes) |
| `web/js/loaders.js` | capture parsing, unit/header detection, filtering, CSV writing (beyond what the CLI's `--unit` does) |
| `web/js/format.js` | `printf` compatible `%.6f` / `%.12g` |
| `web/js/export.js` | C block and JSON block (the layout of `calibrate.py`'s printers), ESPHome lambda, YAML patcher |
| `web/js/plots.js` | the projections and the `\|B\|` histogram, drawn as SVG |
| `web/js/errors.js` | `ValueError` / `LinAlgError` |
| `web/tests/spec.js` | every parity assertion, shared by both runners |
| `web/tests/parity.html` | browser runner |
| `web/tests/parity.test.mjs` | `node --test` runner (CI) |
| `tools/serve.py` | builds and serves the app locally: `python tools/serve.py --open` |
| `tools/build_site.py` | assembles `site/` (the app, its tests, the sample, the offline pages) |
| `tools/build_single_file.py` | bundles the modules into `site/magcal.html` |
| `tools/dump_golden.py` | runs `calibrate.py` and records its answers as the fixture (`--check` for CI) |
| `tools/run_web_tests.py` | drives a headless browser: parity, smoke checks, `file://` banners, offline build |
| `tools/compare_fit_routes.py` | measures the symmetric route against `calibrate.py` and the direct route |

## The offline single file

`tools/build_single_file.py` (called by `tools/build_site.py`) bundles every module into one
classic script and inlines the CSS and the sample capture, producing:

| File | What it is |
| --- | --- |
| `magcal.html` (repository root) | the same file, committed so it is easy to find and double-click; `tools/run_web_tests.py --all` fails if it goes stale |
| `site/magcal.html` | the app, working from `file://` - double-click it |
| `site/magcal-tests.html` | the same core plus the parity suite and the fixture, so the **bundle** is verified offline |

Each module is wrapped in an IIFE whose exports become a namespace object, because top-level
names repeat between modules (`AXES` is a constant in three of them) - plain concatenation would
be a syntax error. The builder refuses to write a page if any module syntax survives, and
`tools/run_web_tests.py --all` opens both files from `file://` and asserts that the app reports
itself ready and that all checks pass.

## Why a symmetric eigensolver

The Python tool takes the eigenvector of the *non-symmetric* `E = C⁻¹(S₁₁ − S₁₂S₂₂⁻¹S₂₁)` for
its largest eigenvalue. Porting a general eigensolver (Hessenberg + shifted QR + back
substitution, ~350 delicate lines) is the one genuinely risky part of a JavaScript port, so the
browser solves the *same* generalized problem `S̃ v = λ C v` symmetrically instead:

```
S̃ = Rᵀ R                                    Cholesky
Ĉ = R⁻ᵀ C R⁻¹   symmetric with Ĉ u = μ u     and μ = 1/λ,  v = R⁻¹ u
```

`tools/compare_fit_routes.py` measures the symmetric route against **`calibrate.py` itself** - the
same code the fixture is generated from - and against a re-implementation of the direct route:

| Capture | Agreement of `b` and `A_1` with `calibrate.py` | Refusals |
| --- | --- | --- |
| the bundled capture | `\|db\|` 4.2e-9, `\|dA\|` 4.1e-8 | none |
| 200 noisy synthetic sweeps | worst 1.2e-10 | 0 - the Cholesky route never failed |
| 50 noiseless synthetic sweeps | worst 2.8e-2, 21 refused | the data is degenerate, see below |

Two things that report also established:

* the two routes, implemented identically, agree to **1.9e-11**, so the 4e-8 against `calibrate.py`
  is not the route choice: it is the Schur complement being formed with `solve` here and `inv`
  there, i.e. cross-implementation drift of the kind the 1e-6 tolerance below absorbs;
* noiseless synthetic data is genuinely degenerate - it satisfies the sphere equation exactly,
  which makes the 10×10 Gram matrix rank deficient. The symmetric route refuses 21 of 50 such
  draws (*does not span enough directions*), and the ones it accepts can be off by a few percent:
  that is why the app and the CLI can disagree on *simulated* captures and agree on real ones.
  Real captures always carry sensor noise.

Because of the route difference the port's numbers are checked at **1e-6 relative** - tighter
than the CLI's own cross-machine drift, and invisible at the six decimals the C block prints.

## Known differences from the CLI

| Difference | Why | Impact |
| --- | --- | --- |
| `max-points` keeps a different subset | the CLI uses numpy's PCG64; the browser uses a seeded mulberry32 PRNG | the number of kept samples is identical, the selection differs; still reproducible |
| noiseless captures can be refused | the symmetric route needs `S̃` positive definite | a capture simulated with zero noise may be rejected as "does not span enough directions"; real captures are unaffected |
| the last digits of the ESPHome lambda can differ | the routes differ by ~4e-8 against `calibrate.py` | physically irrelevant, sensor noise is far larger |
| plots are SVG, not matplotlib | a static page has no matplotlib | same information, different pixels |
| the YAML patch is downloaded, not written in place | browsers cannot write to your disk | safer: the original file is never touched, so no `.bak` is needed |
| `--apply`, `--strict`, exit codes | command line concepts | the app shows the same JSON in a collapsible panel and a PASS/FAIL badge |

## Validating the port

```bash
python tools/dump_golden.py --check     # calibrate.py must still reproduce the fixture
python tools/build_site.py              # site/ + the committed magcal.html at the repo root
python tools/run_web_tests.py --all     # every check: HTTP, file://, offline bundle, offline copy
node --test web/tests                   # the same assertions under Node, as CI runs them
python tools/compare_fit_routes.py      # re-measure the routes against calibrate.py
```

The fixture holds the bundled capture, six seeded synthetic sweeps, the documented rejection
cases, a `printf` battery - including exact decimal ties, where C rounds half to even and
JavaScript's `toFixed` does not - and the C / JSON blocks rendered by `calibrate.py`'s own
printers. `tools/dump_golden.py` rewrites the sections it can regenerate and carries the rest
over; CI runs it with `--check`, so a change on either side fails the build instead of drifting
quietly.

## Publishing

`.github/workflows/pages.yml` runs the parity tests, assembles `site/` with
`tools/build_site.py` and deploys it with `actions/deploy-pages`. One setting has to be flipped
once by a maintainer:

> **Settings → Pages → Build and deployment → Source: "GitHub Actions"**

Publishing needs no server-side code; because the site is uploaded as an artifact there is no
Jekyll step, no `docs/` folder requirement and no build-rate limit.

## Extending it

Add the behaviour to the Python tool first, then:

1. port it into the matching `web/js/*.js` module (same names, same messages);
2. teach `tools/dump_golden.py` to record the new expectation;
3. add the assertion to `web/tests/spec.js`.

Both runners pick it up automatically, so the browser page, `node --test` and CI stay in step.
