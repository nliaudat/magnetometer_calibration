"""Compare the two algebraically equivalent ellipsoid-fit routes.

`calibrate.py` takes `v_1` from the eigenvector of the non-symmetric
`E = C^-1 (S_11 - S_12 S_22^-1 S_21)`.  The dependency-free browser port instead solves the
same generalized problem `S~ v = lambda C v` symmetrically (Cholesky + Jacobi), because
porting a general eigensolver (Hessenberg + shifted QR + back substitution) is the one
genuinely risky part of a JavaScript port.  This script measures the two against each other
using `calibrate.py` itself, which is what justifies the choice in docs/web-app.md.

Run: `python tools/compare_fit_routes.py`
"""

import contextlib
import io
import os
import sys

import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from scipy import linalg  # noqa: E402

from tools.dump_golden import random_capture  # noqa: E402
from calibrate import MagnetometerCalibrator  # noqa: E402

SAMPLE_FILE = os.path.join(REPO_ROOT, "mag_out_sample.txt")
SAMPLE_FIELD = 515.0
FIELD = 500.0                       # the field the synthetic sweeps are built with
DRAWS = 200

C_CONSTRAINT = np.array([[-1, 1, 1, 0, 0, 0],
                         [1, -1, 1, 0, 0, 0],
                         [1, 1, -1, 0, 0, 0],
                         [0, 0, 0, -4, 0, 0],
                         [0, 0, 0, 0, -4, 0],
                         [0, 0, 0, 0, 0, -4]], dtype=float)


def scatter(samples):
    """The 10x10 scatter matrix S = D D^T of the design matrix."""
    s = np.asarray(samples, dtype=float).T
    D = np.array([s[0] ** 2., s[1] ** 2., s[2] ** 2.,
                  2. * s[1] * s[2], 2. * s[0] * s[2], 2. * s[0] * s[1],
                  2. * s[0], 2. * s[1], 2. * s[2], np.ones_like(s[0])])
    return D @ D.T


def stilde(S):
    """The 6x6 pencil `S~ = S_11 - S_12 S_22^-1 S_21` of the eigenproblem."""
    return S[:6, :6] - S[:6, 6:] @ np.linalg.solve(S[6:, 6:], S[6:, :6])


def coefficients(v1, S):
    """M, n, d from the fitted coefficient vector, exactly as `calibrate.py` builds them."""
    v1 = np.asarray(v1, dtype=float)
    v2 = (-linalg.inv(S[6:, 6:]) @ S[6:, :6]) @ v1
    M = np.array([[v1[0], v1[5], v1[4]],
                  [v1[5], v1[1], v1[3]],
                  [v1[4], v1[3], v1[2]]])
    return M, v2[:3].reshape(3, 1), float(v2[3])


def hard_and_soft(M, n, d, field):
    """The `b` and `A_1` `calibrate.py` derives, with its positive-definite guard."""
    M_1 = linalg.inv(M)
    if float(np.min(np.linalg.eigvalsh((M_1 + M_1.T) / 2.0))) <= 0.0:
        raise ValueError("not positive definite: the capture does not span enough directions")
    radius = float((n.T @ M_1 @ n).item()) - d
    if not np.isfinite(radius) or radius <= 0.0:
        raise ValueError("degenerate fit (non-positive radius term)")
    return -M_1 @ n, np.real(field / np.sqrt(radius) * linalg.sqrtm(M))


def direct_route(samples, field):
    """The route `calibrate.py` uses (scipy.linalg.inv + numpy's general eig)."""
    S = scatter(samples)
    eigenvalues, eigenvectors = np.linalg.eig(linalg.inv(C_CONSTRAINT) @ stilde(S))
    v1 = np.real(eigenvectors[:, int(np.argmax(eigenvalues))])
    if v1[0] < 0:
        v1 = -v1
    return hard_and_soft(*coefficients(v1, S), field)


def symmetric_route(samples, field):
    """The port's route: Cholesky + symmetric eigendecomposition, no general eigensolver."""
    S = scatter(samples)
    lower = np.linalg.cholesky(stilde(S))     # raises LinAlgError when not positive definite
    r = lower.T
    chat = np.linalg.solve(r.T, np.linalg.solve(r.T, C_CONSTRAINT).T).T
    mu, u = np.linalg.eigh((chat + chat.T) / 2.0)
    v1 = np.linalg.solve(r, u[:, int(np.argmax(1.0 / mu))])
    v1 = v1 / np.linalg.norm(v1)
    if v1[0] < 0:
        v1 = -v1
    return hard_and_soft(*coefficients(v1, S), field)


def calibrate_py_route(samples, field):
    """`calibrate.py`'s own answer, by running it - the reference the fixture is built from."""
    calibrator = MagnetometerCalibrator(field)
    with contextlib.redirect_stdout(io.StringIO()):
        calibrator.calibrate(np.asarray(samples, dtype=float))
    return np.asarray(calibrator.b), np.asarray(calibrator.A_1)


def relative(actual, expected):
    """Largest absolute difference relative to the magnitude of `expected`."""
    actual = np.asarray(actual, dtype=float).ravel()
    expected = np.asarray(expected, dtype=float).ravel()
    scale = max(float(np.max(np.abs(expected))), 1e-300)
    return float(np.max(np.abs(actual - expected)) / scale)


def attempt(route, samples, field):
    """Run one route, returning the exception instead of raising."""
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            return route(samples, field)
    except Exception as exc:                      # noqa: BLE001 - reported, not raised
        return exc


def condition(samples):
    """cond(S~): how much the Cholesky congruence amplifies round-off (inf when not PD)."""
    eigenvalues = np.linalg.eigvalsh(stilde(scatter(samples)))
    if not np.all(eigenvalues > 0):
        return float("inf")
    return float(eigenvalues.max() / eigenvalues.min())


def compare(label, samples, field):
    """One summary line for a capture; returns the symmetric route's delta against the tool."""
    direct = attempt(direct_route, samples, field)
    symmetric = attempt(symmetric_route, samples, field)
    reference = attempt(calibrate_py_route, samples, field)
    for result in (direct, symmetric, reference):
        if isinstance(result, Exception):
            print("%-16s direct=%-14s symmetric=%-14s calibrate.py=%-14s" % (
                label,
                type(direct).__name__ if isinstance(direct, Exception) else "ok",
                type(symmetric).__name__ if isinstance(symmetric, Exception) else "ok",
                type(reference).__name__ if isinstance(reference, Exception) else "ok"))
            return None
    against_tool = max(relative(symmetric[0], reference[0]), relative(symmetric[1], reference[1]))
    spread = max(relative(symmetric[0], direct[0]), relative(symmetric[1], direct[1]))
    print("%-16s symmetric vs calibrate.py |db| %.1e |dA| %.1e  |  route spread %.1e  |  "
          "cond(S~) %.1e"
          % (label, relative(symmetric[0], reference[0]), relative(symmetric[1], reference[1]),
             spread, condition(samples)))
    return against_tool


def main():
    rng = np.random.default_rng(12345)
    raw = np.loadtxt(SAMPLE_FILE, delimiter=",")

    print("-- bundled capture (real data)")
    reference = compare("reference", raw, SAMPLE_FIELD) or 0.0

    print("-- synthetic sweeps (30..800 samples, every 5th draw squashes the z coverage)")
    worst = 0.0
    refused = 0
    accepted = 0
    for index in range(DRAWS):
        coverage = None if index % 5 else float(rng.uniform(0.1, 0.7))
        samples, _ = random_capture(rng, count=int(rng.integers(30, 800)), coverage=coverage)
        direct = attempt(direct_route, samples, FIELD)
        if isinstance(direct, Exception):
            continue
        accepted += 1
        symmetric = attempt(symmetric_route, samples, FIELD)
        reference_py = attempt(calibrate_py_route, samples, FIELD)
        if isinstance(symmetric, Exception) or isinstance(reference_py, Exception):
            refused += 1
            continue
        worst = max(worst, relative(symmetric[0], reference_py[0]),
                    relative(symmetric[1], reference_py[1]))
    print("%d draws: worst |d| against calibrate.py = %.2e, refused by the symmetric route: %d"
          % (accepted, worst, refused))

    print("-- noiseless sweeps (a perfect sphere leaves S~ rank deficient)")
    perfect_accepted = 0
    perfect_refused = 0
    perfect_worst = 0.0
    for index in range(50):
        samples, _ = random_capture(rng, count=int(rng.integers(30, 800)), noise=0.0)
        reference_py = attempt(calibrate_py_route, samples, FIELD)
        if isinstance(reference_py, Exception):
            continue
        perfect_accepted += 1
        symmetric = attempt(symmetric_route, samples, FIELD)
        if isinstance(symmetric, Exception):
            perfect_refused += 1
            continue
        perfect_worst = max(perfect_worst, relative(symmetric[0], reference_py[0]),
                            relative(symmetric[1], reference_py[1]))
    print("%d noiseless draws: refused by the symmetric route %d, worst |d| %.2e"
          % (perfect_accepted, perfect_refused, perfect_worst))

    print("-- degenerate captures")
    angles = np.linspace(0.0, 2.0 * np.pi, 200)
    compare("planar", np.column_stack([100.0 * np.cos(angles), 100.0 * np.sin(angles),
                                       1e-3 * np.sin(5.0 * angles)]), FIELD)
    compare("collinear", np.column_stack([np.linspace(0.0, 10.0, 50),
                                          np.zeros(50), np.zeros(50)]), FIELD)
    compare("constant", np.ones((20, 3)), FIELD)

    print("DECISION: the port uses the symmetric route - %.1e on the bundled capture and "
          "%.1e on %d sweeps against calibrate.py itself, %d refusals"
          % (reference, worst, accepted, refused))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
