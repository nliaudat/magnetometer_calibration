# Calibration quality

The magnitude of the magnetic field is constant in a fixed location, so after a correct
calibration every sample should have the same `|B| == --field`. The tool reports that
residual before/after (the same metric `magcal` uses) plus how well the capture covered
the three axes. Example with the bundled sample (`--field 515`):

```
Calibration quality (target |B| = 515 microTesla):
                                 raw    calibrated
  |B| mean                    591.26        514.99
  |B| std                      26.59          3.33
  |B| min                     521.97        503.97
  |B| max                     637.65        526.20
  RMS error                    80.76          3.33
  error %                      15.68          0.65
  axis spans (raw)        X=381.9, Y=377.2, Z=73.5
  coverage (min/max span) 19.2%
  covariance condition    83.5
  result                  PASS
  warning: Z axis span is only 19.2% of the widest axis; the ellipsoid fit is poorly constrained - redo the capture rotating the sensor through all three axes
```

Rules of thumb:

* **error %** — the calibrated residual. Under ~1% is excellent, under 5% is fine for a
  compass heading, more than 5% means the capture (or `--field`) is wrong.
* **coverage** — `min(axis span)/max(axis span)`. Below 30% the ellipse is under-constrained
  on one axis: roll/pitch the sensor as well as spinning it flat, then re-capture.
* **RMS error (raw)** — how bad the sensor was *before* calibration; if it is already
  small the sensor may not need calibration at all.

`--report json` returns the same numbers (schema v2) for scripts, and `--strict` turns the
result into an exit code (3) so a pipeline can reject a bad capture.

> **Note on `--field`:** the field strength only scales the result, so the *heading* is
> unaffected by it; it matters when you use the calibrated vector for tilt compensation or
> for the `|B|` quality metric. Use your local total field (see
> [gravitation-field.md](gravitation-field.md)), or the *raw* value expected by the sensor
> register (default 1000, as in the original tool).
