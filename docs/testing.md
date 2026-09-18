# Tests

```bash
python -m pytest          # pytest (configuration lives in pyproject.toml)
python -m tests           # same suite without any extra dependency
```

The suite covers the ellipsoid maths against synthetic hard/soft iron captures, every
input format and unit combination, the JSON schema (v1 and v2), the residual/coverage
reports, the ESPHome patcher, headless plotting and the CLI exit codes.

The golden files in `tests/data/` freeze the CLI text and JSON output in two modes:

* **banded** (default) — structure, layout, key sets, decimal places, constant names and
  row counts are pinned exactly, while numbers are compared to a physical band (`1e-3`
  relative, `±1 µT` on the hard iron bias, residual inside a `0.4–1 %` window, plus the
  invariants in `test_calibration_physics_invariants`). The last digits of an ellipsoid
  fit depend on the numpy/scipy version and the BLAS/LAPACK build, so a different machine
  drifts by ~1e-10…1e-6 relative — that is not a regression, while any real error (wrong
  unit ×100, swapped axis, dropped samples) is orders of magnitude larger and still fails.
* **strict** — `GOLDEN_STRICT=1 python -m pytest` restores machine-level comparisons
  (`1e-12`, full precision text). It is what the `numeric-canary` CI job runs against a
  pinned `constraints.txt` stack: it *reports* cross-machine numeric drift without
  blocking the build, and verifies that a calibration is reproducible across BLAS thread
  counts.

Failure messages always state the drift, the active tolerance and the numeric stack that
produced it (`python … | numpy … | scipy … | mode …`).
