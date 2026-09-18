# Magnetometer calibration — documentation

Reference material for the magnetometer calibration tool: the [root README](../README.md)
has the install and the quick start, everything below goes deeper.

## Start here

| If you want to… | Read |
| --- | --- |
| calibrate a sensor and paste the result into firmware | [usage.md](usage.md) |
| know which capture files are accepted | [input-formats.md](input-formats.md) |
| understand the printed C code / JSON / saved files | [outputs.md](outputs.md) |
| check whether a calibration is any good | [quality.md](quality.md) |
| fix something that went wrong | [troubleshooting.md](troubleshooting.md) |
| use ESPHome | [esphome.md](esphome.md) |
| pick the `--field` value | [gravitation-field.md](gravitation-field.md) |
| understand the math | [algorithm.md](algorithm.md) |
| run or extend the tests, package the tool | [testing.md](testing.md) · [development.md](development.md) |
| see who is credited (and why the code looks like this) | [history.md](history.md) |

## All documents

| Document | What it covers |
| --- | --- |
| [usage.md](usage.md) | Recommended capture, examples, **every command line option**, exit codes, requirements |
| [input-formats.md](input-formats.md) | CSV / TXT / raw log layouts, delimiter, header and unit auto-detection |
| [outputs.md](outputs.md) | C code and JSON blocks, `<input>_calibration.json` (schema v1/v2), calibrated data files, plots |
| [quality.md](quality.md) | `\|B\|` residual and coverage metrics, how to read the report, `--report json`, `--strict` |
| [esphome.md](esphome.md) | `--esphome`, the in-place `--esphome-file … --esphome-update`, heading and declination, the C/ESPHome snippet |
| [algorithm.md](algorithm.md) | The ellipsoid fit (Li & Griffiths, k = 4) and the hard iron / soft iron model |
| [testing.md](testing.md) | Running the suite, banded vs strict golden comparisons, CI jobs |
| [development.md](development.md) | Install, module map / architecture, packaging, how to extend the tool |
| [troubleshooting.md](troubleshooting.md) | Symptom → cause → fix for the usual failures (deps, interpreter, "0 tests collected", high residual, …) |
| [history.md](history.md) | Project history, the `v_1` index bug and its fix, credits, sources |
| [gravitation-field.md](gravitation-field.md) | Expected field strength for your location, and how to convert it to the sensor's raw value |

## Reading order

* **I just want a calibration** → [usage.md](usage.md) → paste the output into your
  firmware ([esphome.md](esphome.md) if you use ESPHome).
* **Is my calibration any good?** → [quality.md](quality.md) (and
  [input-formats.md](input-formats.md) if the tool complains about your capture).
* **I want to know how it works** → [algorithm.md](algorithm.md) →
  [history.md](history.md).
* **I want to change the code** → [development.md](development.md) →
  [testing.md](testing.md).
