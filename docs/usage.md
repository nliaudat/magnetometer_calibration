# Usage

1) Output your raw data from the sensor and name it `mag_out.txt`, one `x,y,z` row per
   line in µT (or use a CSV file, with or without a header — see
   [Input formats](input-formats.md)).

2) Optionally set the expected magnetic field strength with `--field` according to
   [gravitation-field.md](gravitation-field.md)
   (default is 1000, which is the *raw* value for some sensors; see the note below).

3) Run the script. `python calibrate.py` alone uses `mag_out.txt`:

```bash
python calibrate.py -f mag_out.txt --field 515
```

4) Collect the "hard iron bias" and "soft iron bias" values (C code, JSON, or a ready
   to paste ESPHome lambda).

### Recommended capture

Rotate the sensor slowly through **all three axes** (not just a flat horizontal spin)
and avoid leaving it parked: a capture where one axis barely moves cannot constrain
the fit, and the tool will tell you so (see [Calibration quality](quality.md)).

### Examples

```bash
# calibrate a CSV capture and show before/after plots
python calibrate.py -f magnetometer_data.csv --field 515 --plot

# calibrate, print the C/JSON blocks, but do not write the calibrated data
python calibrate.py -f mag_out.txt --json --no-save

# re-apply an existing calibration (default file: <input>_calibration.json)
python calibrate.py -f data.csv --apply --plot
python calibrate.py -f data.csv --apply calibration.json --report json

# machine readable quality report, non-zero exit code when the fit is bad (CI/automation)
python calibrate.py -f mag_out.txt --report json --strict --max-error 2

# headless plots (no window, useful on a server)
python calibrate.py -f mag_out.txt --plot-file figures/calibration.png

# raw ESPHome logs are read directly, no cleanup step needed
python calibrate.py -f esp_log.txt --json

# print a paste-ready ESPHome lambda, or patch esphome_code.yaml in place (.bak kept)
python calibrate.py -f mag_out.txt --esphome
python calibrate.py -f mag_out.txt --esphome-file esphome_code.yaml --esphome-update
```

### Command line options

| Option | Description |
| --- | --- |
| `-f, --file PATH` | Input file (CSV, TXT, raw log, or `-` for stdin). Default: `mag_out.txt` |
| `-y, --force` | Overwrite output files without asking |
| `-o, --output PATH` | Write the calibrated data to this path |
| `--apply [JSON]` | Apply an existing calibration instead of calibrating (default: `<input>_calibration.json`) |
| `--json` | Save the calibration parameters as JSON (schema v2, includes diagnostics) |
| `--save` / `--no-save` | Write / do not write `<input>_calibrated.csv` (default: write) |
| `--field µT` | Expected magnetic field strength in µT (default: 1000) |
| `--unit UNIT` | `microtesla`, `gauss`, `nanotesla`, `tesla`, or `auto` (default: `auto`, i.e. use the unit in the column names) |
| `--extract-pattern REGEX` | Regex with 3 groups (x, y, z) to pull samples out of logs |
| `--min-delta µT` | Drop samples closer than µT to the previous kept one (ignores parked captures) |
| `--max-points N` / `--seed S` | Randomly subsample the capture (reproducible with the seed) |
| `--report text\|json\|none` | Quality report: human readable (default), JSON on stdout, or off |
| `--max-error PERCENT` | Residual error target (default: 5%) |
| `--strict` | Exit with code 3 when the residual error target is missed |
| `-p, --plot` | Show the before/after plots in a window |
| `--plot-file PATH` | Save the plots to PATH (`_magnitude` suffix for the second figure) |
| `--esphome` | Print a paste-ready ESPHome lambda with the coefficients |
| `--esphome-file YAML --esphome-update` | Replace the 12 coefficients inside an ESPHome YAML file (keeps a `.bak`, all-or-nothing) |
| `--declination DEG` | Magnetic declination added to the reported/emitted heading |
| `--heading` | Report heading statistics (raw vs calibrated) |
| `-q, --quiet` / `-v, --verbose` / `--debug` | Less output / more output / full traceback |

Progress and warnings always go to **stderr**, so `--report json` produces strict,
parseable JSON on stdout.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | error (bad input, missing file, unusable capture) |
| 2 | usage error (unknown argument) |
| 3 | quality check failed while `--strict` was set |

## Requirements

`calibrate.py` / `magcal` requires **numpy** and **scipy**; **matplotlib** is optional
(only for `--plot` / `--plot-file`); **pytest** is optional (tests). See
`requirements.txt` and `requirements-dev.txt`; `pip install -e .` installs the package
and the `magcal` console script.
