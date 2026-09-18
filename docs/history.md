# Project history and credits

## Timeline

| When | What |
| --- | --- |
| 2021-06-25 | Repository started (`calibrate.py`, `esphome_code.yaml`, sample capture) |
| 2021 → 2024 | Maintenance updates to `calibrate.py` |
| 2022-11-09 | **Issue #1 opened by [John zhang12300](https://github.com/zhang12300)** — the `v_1` index bug described below |
| 2023-10-08 | **[jremington](https://github.com/jremington) posted the fix** in issue #1, validated against the `magneto` C program |
| 2023-10-09 | Fix committed (`61f5ab1`, “Update calibrate.py”), issue closed |
| 2025-08-21 | **[domsl](https://github.com/domsl) PR #5** turned the script into a CLI: flags, CSV/TXT auto-detection, µT/Gauss units, JSON calibration, `--apply`, help, overwrite protection, before/after plots |
| 2026-09 | This fork: **v2** robustness + diagnostics (auto delimiter/header/unit detection, raw log support, `\|B\|` quality report with coverage warnings, ESPHome export, JSON schema v2, test suite, CI) and **v3** structure (`magcal` package with the `calibrate.py` shim, banded golden tests, packaging with the `magcal` console script, documentation split) |

## The `v_1` index bug (issue #1)

The fit returns the vector `v_1`; mapping it onto the quadratic form
`xᵀ M x + 2 nᵀ x + d = 0` must put the `2XZ` term in `g` (`v_1[4]`), the `2XY` term in `h`
(`v_1[5]`) and the `2YZ` term in `f` (`v_1[3]`) — i.e. `M = [[a h g], [h b f], [g f c]]`.
The original code (copied from the Teslabs article) placed the `XY` term in the `f` slots:

```python
# wrong: the 2XY term sat in the f positions
M = np.array([[v_1[0], v_1[3], v_1[4]],
              [v_1[3], v_1[1], v_1[5]],
              [v_1[4], v_1[5], v_1[2]]])
```

As a result `A_1` came out with a mirrored first row/column. John zhang12300 noticed the
inconsistency between the article and the code; the maintainer reproduced the analysis
from a comment on the Teslabs page (quoted there as *Robert R* — the surviving code
comment spells the name *Roger R*) and acknowledged that the code had been copied without
a deep analysis. jremington then posted the exact correction:

```python
# fixed: 2XZ → v_1[4] (g), 2XY → v_1[5] (h), 2YZ → v_1[3] (f)
M = np.array([[v_1[0], v_1[5], v_1[4]],
              [v_1[5], v_1[1], v_1[3]],
              [v_1[4], v_1[3], v_1[2]]])
```

and validated it against a known 3-D dataset solved independently with the `magneto` C
program (Pololu “Balboa magnetometer” thread). It was committed the next day as `61f5ab1`
and those are the values the golden tests in this fork still freeze — see
[algorithm.md](algorithm.md) for where the matrix comes from and
[testing.md](testing.md) for how it is guarded.

Links: [issue #1](https://github.com/nliaudat/magnetometer_calibration/issues/1) ·
[commit 61f5ab1](https://github.com/nliaudat/magnetometer_calibration/commit/61f5ab1) ·
[PR #5](https://github.com/nliaudat/magnetometer_calibration/pull/5)

## Working demo

If you want a sample or a working demo, look at https://github.com/nliaudat/weatherstation

## Thanks

[John zhang12300](https://github.com/zhang12300) for issuing the bug

[jremington](https://github.com/jremington) for fixing the bug

[domsl](https://github.com/domsl) for improvements in PR#5

## Sources

- https://teslabs.com/articles/magnetometer-calibration/
- https://www.best-microcontroller-projects.com/hmc5883l.html
