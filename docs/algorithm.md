# Algorithm

What the tool estimates, and how — this is the reference for
[`magcal/ellipsoid.py`](../magcal/ellipsoid.py) and
[`magcal/calibration.py`](../magcal/calibration.py).

## The model

A magnetometer reading is distorted in two ways:

* **hard iron** — a constant offset `b` (µT) caused by nearby permanent magnets or
  magnetised metal;
* **soft iron** — a linear distortion `A_soft`, caused by ferromagnetic material that
  bends the field, so the measured ellipsoid is stretched and rotated.

Both are captured by one affine correction: for the true field vector `v`,

```
raw  = A_soft · v + b          (the measurement)
v    = A_1 · (raw − b)         (the correction the tool computes)
```

`A_1` (called `soft_iron_matrix`, and `soft_iron_bias_*` in the generated C code) also
scales the result so that `|v| = F`, the expected field strength you pass with `--field`.

## The fit

The tool uses the **ellipsoid-specific least squares fit** of Li & Griffiths (2004): it
fits the quadratic form

```
xᵀ M x + 2 nᵀ x + d = 0
```

to the capture with the `k = 4` constraint, which guarantees an ellipsoid (not a general
conic). `magcal/ellipsoid.py` implements it literally, and its comments name the equations
of the paper:

| Code | Paper |
| --- | --- |
| `D`, `S`, `S_11…S_22` | design matrix and scatter matrices (eq. 11) |
| `C` | the `k = 4` constraint matrix (eq. 8) |
| `E`, `v_1` | reduced eigenproblem, one positive eigenvalue (eq. 15) |
| `v_2` | remaining coefficients (eq. 13) |

From the fitted `M, n, d` the coefficients follow in closed form:

```
centre        b       = −M⁻¹ n
radius term   k       = nᵀ M⁻¹ n − d
correction    A_1     = F / √k · sqrtm(M)
```

so that `A_1ᵀ A_1 = (F²/k) M` and therefore `|A_1 (x − b)| = F` for every sample — the
whole point of the calibration: after correction the field magnitude is constant.

`sqrtm` is the matrix square root: `A_1` is the "half" of the ellipsoid shape, applied
once instead of twice.

## Why `A_1` is symmetric

`M` is symmetric by construction, `sqrtm(M)` of a symmetric matrix is symmetric, and the
scalar `F/√k` does not change that. This is why the generated C snippet (`v @ A_1`) and the
Python implementation (`v @ A_1ᵀ`) give the same result; if a capture ever produced an
asymmetric matrix the tool logs a warning (`soft-iron matrix is not symmetric`).

## Guards before a fit is trusted

An ellipsoid fit always returns *something*, so `magcal/ellipsoid.py` validates the result
and raises a clear `ValueError` instead of returning NaN or complex coefficients:

| Check | Failure message (short) |
| --- | --- |
| at least 10 samples | *need at least 10 samples for an ellipsoid fit* |
| all values finite | *data contains NaN or infinite values* |
| every axis moves | *axis X never changes in this capture* |
| `M` invertible, `M⁻¹` positive definite | *fit is not positive definite: the capture does not span enough directions* |
| `k > 0` | *degenerate ellipsoid fit (non-positive radius term)* |
| `sqrtm(M)` real | *fit has no real soft-iron solution* |
| real-valued fit | *ellipsoid fit has no real solution (shape matrix is complex)* |

## What `--field` does and does not do

`F` only **scales** `A_1`. Consequences:

* the **heading** (`atan2`) is unaffected by `F` — a wrong `F` cannot skew a compass;
* `F` matters for the magnitude-based quality metric (`|B| == F`), for tilt compensation,
  and for consumers that use the vector, not just its direction;
* so a heading-only use case tolerates a rough `--field`, while a quality report does not.

See [gravitation-field.md](gravitation-field.md) for how to obtain `F`.

## History: the `v_1` index swap

The mapping from the fitted vector `v_1` to the matrix `M` was wrong in the original code
(and on the Teslabs page it came from): the `2XY` term was placed in the `f` positions
instead of the `h` positions, so `A_1` came out with a mirrored first row/column. The bug
was reported in issue #1 and fixed by the correction quoted there; see
[history.md](history.md) for the full story and the exact matrices.

## References

* Qingde Li, J.G. Griffiths, *Least squares ellipsoid specific fitting*, Geometric Modeling
  and Processing, 2004, pp. 335–340 (the solver).
* <https://teslabs.com/articles/magnetometer-calibration/> (magnetometer calibration with
  this fit, hard/soft iron explanation).
* <https://www.best-microcontroller-projects.com/hmc5883l.html> (HMC5883L specifics).
