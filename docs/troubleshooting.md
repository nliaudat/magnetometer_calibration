# Troubleshooting

Symptom → cause → fix. For the meaning of a *successful* run's output see
[quality.md](quality.md); for the test suite see [testing.md](testing.md).

## Install / interpreter problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ModuleNotFoundError: numpy` (or `scipy`, `matplotlib`) | the command ran with an interpreter that has no dependencies (IDE venv, conda env, system Python) | install in *that* interpreter: `pip install -r requirements.txt`; matplotlib is only needed for `--plot`/`--plot-file` |
| `No module named pytest` | dev requirements missing | `pip install -r requirements-dev.txt`, or run the suite without pytest: `python -m tests` |
| Test panel says **“no tests found”** / `collected 0 items` (exit code 5) | the workspace root is not the repository root, so `testpaths = ["tests"]` is never read | open the `magnetometer_calibration` folder as the workspace, or set `"python.testing.pytestArgs": ["tests"]` |
| `AttributeError: module 'calibrate' has no attribute 'Options'` (or another missing name) | a stale **non-editable** copy of the package shadows this checkout | `pip uninstall magcal` and reinstall editable: `pip install -e .` |
| `PytestCacheWarning … [WinError 32] … .pytest_cache` | a second pytest process or a cloud-sync client (Dropbox/OneDrive) holds the cache file | the suite already disables the cache (`-p no:cacheprovider`); if you see this, you added `-p cacheprovider` yourself or run an old checkout — otherwise it is harmless and can be ignored |
| Huge diffs full of line-ending changes | `core.autocrlf` / editor defaults | leave it to git; new files are normalized on commit |

Rule of thumb: **the interpreter that runs the tool must be the one you installed into**.
`python -c "import sys, numpy, scipy; print(sys.executable, numpy.__version__, scipy.__version__)"`
printed with the same command you use for the tool answers this in one line.

## Capture / fit problems

| Message or symptom | Cause | Fix |
| --- | --- | --- |
| `axis Z never changes in this capture` | the sensor was not moved around that axis | rotate through **all three axes** (roll/pitch *and* spin), see [usage.md](usage.md) |
| `need at least 10 samples for an ellipsoid fit` | capture too short | record longer (a few hundred samples) |
| `fit is not positive definite: the capture does not span enough directions` | planar or nearly planar data | re-capture with 3-D coverage |
| `degenerate ellipsoid fit` / `has no real soft-iron solution` | collinear, duplicated or numerically degenerate data | remove parked/duplicate rows (`--min-delta 1`), re-do the sweep |
| `singular ellipsoid fit` | all samples identical or 1-D motion | same as above |
| `warning: Z axis span is only 19 % of the widest axis` | weak coverage on one axis | acceptable if your only use case is a flat spin, otherwise re-capture |
| `error %` above 5 | wrong `--field`, wrong unit, or motion during capture | check the value ([gravitation-field.md](gravitation-field.md)), try `--unit`, and check `--report json` → `input.rows_used`/`input.input_unit` to confirm what was loaded |
| calibrated `|B|` is ≈100× too large or too small | unit mis-detection (gauss vs µT) | pass `--unit microtesla` or `--unit gauss` explicitly — the loader prints the unit it detected |
| heading is rotated by a constant angle | magnetic vs true north | `--declination <degrees>` (see [esphome.md](esphome.md)) |
| calibration looks good but the compass drifts | the tool was fit on a capture from a different sensor mounting | re-capture on the finished device ([usage.md](usage.md)) |

## Exit codes and automation

| Code | Meaning | Typical cause |
| --- | --- | --- |
| 0 | success | — |
| 1 | error | missing input file, unusable capture, unreadable calibration JSON — the message on **stderr** says which |
| 2 | usage error | unknown or malformed argument |
| 3 | quality check failed | `--strict` was set and the residual exceeded `--max-error` |

`--report json` prints one strict JSON object on **stdout**; progress and warnings go to
**stderr**, so pipelines can parse stdout directly. If parsing fails, something else wrote
to stdout (a wrapper like `tee`, a shell banner) or an old checkout printed progress there.

## Numeric / test surprises

* A golden test fails with a **tiny** delta (≈1e-9) → numeric drift between machines, not a
  regression: the message prints the delta, the active tolerance and the numeric stack. See
  [testing.md](testing.md) for the banded/strict modes.
* A golden test fails with a **large** delta → a real behaviour change; compare
  `--report json` before/after and open an issue with both outputs.

## Still stuck?

Collect these and you have everything needed to diagnose a report:

```bash
python -V
python -c "import sys, numpy, scipy; print(sys.executable, numpy.__version__, scipy.__version__)"
python calibrate.py -f <your capture> --field <your field> --report json > report.json
```
