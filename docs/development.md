# Development

## Install

```bash
pip install -r requirements.txt        # numpy, scipy, matplotlib (plotting only)
pip install -r requirements-dev.txt    # + pytest, for the test suite
pip install -e .                       # optional: installs the `magcal` command
```

Two entry points behave identically, so existing commands keep working:

```bash
python calibrate.py -f mag_out.txt --field 515     # script (backwards compatible)
magcal -f mag_out.txt --field 515                  # console script (pip install -e .)
```

Requirements: Python >= 3.9, numpy, scipy; matplotlib only for the plots.
`pandas` is **not** required any more (CSV parsing uses the standard library).

## Module map

| Path | Responsibility |
| --- | --- |
| `calibrate.py` | thin, backwards compatible CLI shim (imports `magcal`, runs `main()`) |
| `magcal/cli.py` | argparse definition, logging setup, `main(argv)` and the exit codes |
| `magcal/pipeline.py` | `Options` record and the run steps: load → calibrate/apply → report → outputs |
| `magcal/loaders.py` | CSV/TXT/log parsing, delimiter/header/unit detection, filtering, CSV writing |
| `magcal/ellipsoid.py` | Li & Griffiths least squares ellipsoid fit plus numeric validation |
| `magcal/calibration.py` | `build_calibration()` and the `MagnetometerCalibrator` facade |
| `magcal/model.py` | dataclasses for every record (calibration, diagnostics, parse/filter reports) |
| `magcal/diagnostics.py` | `\|B\|` residual and coverage metrics, heading statistics, text reports |
| `magcal/serialization.py` | JSON schema v1/v2 plus the C code / JSON block renderers |
| `magcal/esphome.py` | ESPHome lambda generation and the in-place YAML patcher |
| `magcal/plotting.py` | optional matplotlib visualisations (imported lazily) |
| `magcal/validation.py` | small numeric helpers shared by the modules |
| `magcal/constants.py` | units, defaults, thresholds and regular expressions |
| `tests/` | one test module per area; `python -m tests` runs them without pytest |
