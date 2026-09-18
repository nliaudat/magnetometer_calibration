"""Regenerate the fixture that validates the browser port against `calibrate.py`.

The fixture in `web/tests/golden/python-golden.json` is what makes the JavaScript port
verifiable: every expectation in it comes from the Python tool.  It has two kinds of section:

* **regenerated here** - the fits (the bundled capture and six seeded synthetic sweeps), the
  `printf` battery and the C / JSON blocks, all produced by running `calibrate.py` itself;
* **carried over unchanged** - the sections the legacy CLI cannot produce (no `|B|` quality
  report, no capture-parsing report, no ESPHome export): `diagnostics`, `loaders`, `filters`,
  `rejections` and the ESPHome lambdas.  They are read from the committed fixture and written
  back verbatim, so `--check` never claims to have verified them.

Run: `python tools/dump_golden.py [--check]`
"""

import argparse
import contextlib
import io
import json
import os
import sys

import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from calibrate import MagnetometerCalibrator  # noqa: E402  (the legacy tool itself)

FIXTURE = os.path.join(REPO_ROOT, "web", "tests", "golden", "python-golden.json")
SAMPLE_FILE = os.path.join(REPO_ROOT, "mag_out_sample.txt")
SAMPLE_FIELD = 515.0          # the field the bundled capture was recorded at
SYNTHETIC_FIELD = 500.0       # the synthetic sweeps are arbitrary; this is the value the

# recorded expectations were built with, so changing it rewrites the whole fixture
GENERATED_BY = "tools/dump_golden.py"

# The sections this script rewrites; everything else is carried over from the fixture.
REGENERATED = ("reference", "synthetic", "formatting", "blocks")

# Input the C / JSON / ESPHome texts are rendered from.  Frozen, not re-fitted here, because
# the ESPHome texts are recorded expectations: the JS must format exactly these numbers.
BLOCK_CALIBRATION = {
    "field": 515.0,
    "hard_iron": [41.16886643832051, -89.87465740118957, 569.6639294497097],
    "soft_iron": [[2.7119376318758057, 0.027824927375110633, -0.11383145869936333],
                  [0.027824927375110425, 2.750883738489589, 0.02972420961626294],
                  [-0.11383145869936347, 0.029724209616262865, 3.357967789190612]],
}

# (label, samples, noise uT, z coverage squash) - the sweeps the port must reproduce.
SYNTHETIC_CASES = [
    ("sphere-250", 250, 0.3, None),
    ("sphere-600", 600, 0.3, None),
    ("sparse-40", 40, 0.5, None),
    ("weak-z-0.6", 300, 0.3, 0.6),
    ("weak-z-0.25", 300, 0.3, 0.25),
    ("noisy-2uT", 400, 2.0, None),
]

FORMAT_VALUES = [
    0.0, 1.0, -1.0, 0.5, 1e-7, -1e-7, 1e-4, 0.000123456789012345,
    2.7119376318758057, 0.027824927375110633, -0.11383145869936333,
    3.357967789190612, 41.16886643832051, -89.87465740118957, 569.6639294497097,
    1234567890123.5, 99999999999.9999, 1e20, 1.5e-9, 6.02e23, -0.0,
    # exact decimal ties for %.6f: C rounds half to even, whereas JavaScript's toFixed
    # rounds ties away from zero, so these pin the difference.
    0.0078125, 0.0234375, -0.0078125, 0.0000005, 2.0000005, 12.3456785,
]


def fibonacci_sphere(count):
    """Directions spread uniformly over the unit sphere (used by the synthetic sweeps)."""
    index = np.arange(count, dtype=float) + 0.5
    phi = np.arccos(1.0 - 2.0 * index / count)
    theta = np.pi * (1.0 + 5.0 ** 0.5) * index
    return np.column_stack([np.cos(theta) * np.sin(phi),
                            np.sin(theta) * np.sin(phi),
                            np.cos(phi)])


def random_capture(rng, count=600, soft_scale=0.25, hard_scale=60.0, coverage=None, noise=0.3):
    """A synthetic sweep: random soft iron, random hard iron, uniform directions, sensor noise.

    Noiseless data is *not* easier: it satisfies the sphere equation exactly, which makes the
    10x10 Gram matrix rank deficient and every solver noise dominated, so the noise stays in.
    """
    directions = fibonacci_sphere(count)
    if coverage is not None:                     # squash the z sweep (partial coverage)
        directions = directions.copy()
        directions[:, 2] *= coverage
        directions /= np.linalg.norm(directions, axis=1, keepdims=True)
    factor = rng.normal(size=(3, 3)) * soft_scale + np.eye(3)
    soft = factor @ factor.T + 0.05 * np.eye(3)
    hard = rng.normal(size=3) * hard_scale
    true = directions * SYNTHETIC_FIELD
    samples = np.linalg.solve(soft, true.T).T + hard
    if noise:
        samples = samples + rng.normal(scale=noise, size=samples.shape)
    return samples, true


def _rounded(samples, digits=6):
    """Round a capture so JavaScript fits bit-identical inputs to the ones recorded here."""
    return [[float(round(value, digits)) for value in row] for row in samples]


def describe(samples, field):
    """Run `calibrate.py` on one capture; return its coefficients and the quality numbers.

    The legacy CLI prints as it goes, so its chatter is captured and dropped.  The quality
    numbers are the documented `|B|` residual (RMS of `|A_1 (x - b)|` against the field) and
    the coverage ratio, which the CLI itself does not report.
    """
    array = np.asarray(samples, dtype=float)
    calibrator = MagnetometerCalibrator(field)
    with contextlib.redirect_stdout(io.StringIO()):
        calibrator.calibrate(array)
    residual = np.linalg.norm(calibrator.apply_calibration(array), axis=1) - field
    raw = np.linalg.norm(array, axis=1) - field
    spans = np.ptp(array, axis=0)
    percent_error = float(100.0 * np.sqrt(np.mean(residual ** 2)) / abs(field))
    return {
        "field": float(field),
        "hard_iron": [float(value) for value in np.asarray(calibrator.b).reshape(3)],
        "soft_iron": [[float(value) for value in row] for row in np.asarray(calibrator.A_1)],
        "percent_error": percent_error,
        "raw_percent_error": float(100.0 * np.sqrt(np.mean(raw ** 2)) / abs(field)),
        "coverage_ratio": float(spans.min() / spans.max()),
        "passed": bool(percent_error <= 5.0),
    }


def legacy_print(calibration, method):
    """Return what `calibrate.py`'s own printer writes for a given calibration."""
    calibrator = MagnetometerCalibrator(calibration["field"])
    calibrator.b = np.asarray(calibration["hard_iron"], dtype=float).reshape(3, 1)
    calibrator.A_1 = np.asarray(calibration["soft_iron"], dtype=float)
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        getattr(calibrator, method)()
    return buffer.getvalue()


def reference_case():
    """The bundled capture: its samples and the fit `calibrate.py` makes of them."""
    samples = _rounded(np.loadtxt(SAMPLE_FILE, delimiter=","))
    entry = describe(samples, SAMPLE_FIELD)
    entry["label"] = "reference"
    entry["samples"] = samples
    return entry


def synthetic_case():
    """Seeded sweeps with realistic sensor noise, including weak-axis captures."""
    rng = np.random.default_rng(20240918)
    cases = []
    for label, count, noise, coverage in SYNTHETIC_CASES:
        samples, _ = random_capture(rng, count=count, coverage=coverage, noise=noise)
        rounded = _rounded(samples)
        entry = describe(rounded, SYNTHETIC_FIELD)
        entry["label"] = label
        entry["samples"] = rounded
        cases.append(entry)
    return cases


def formatting_battery():
    """Python's own printf output: the reference for the JavaScript formatters."""
    return {
        "six_decimals": [[value, "%.6f" % value] for value in FORMAT_VALUES],
        "twelve_g": [[value, "%.12g" % value] for value in FORMAT_VALUES],
    }


def blocks(frozen):
    """The C / JSON blocks from `calibrate.py`; the ESPHome texts carried over unchanged."""
    result = dict(frozen or {})
    result["calibration"] = BLOCK_CALIBRATION
    result["c_code"] = legacy_print(BLOCK_CALIBRATION, "print_c_code")
    result["json_block"] = legacy_print(BLOCK_CALIBRATION, "print_json_format")
    return result


def recorded_sections(frozen):
    """Names of the parts of the fixture this script does not regenerate."""
    names = sorted(key for key in ("rejections", "diagnostics", "loaders", "filters")
                   if key in frozen)
    names.extend(key for key in sorted((frozen.get("blocks") or {}))
                 if key.startswith("esphome"))
    return names


def build(frozen=None):
    """Return the regenerated fixture, keeping the sections this script cannot produce."""
    frozen = frozen or {}
    fixture = {
        "generator": GENERATED_BY,
        "recorded": recorded_sections(frozen),
        "reference": reference_case(),
        "synthetic": synthetic_case(),
        "formatting": formatting_battery(),
        "blocks": blocks(frozen.get("blocks")),
    }
    for key in ("rejections", "diagnostics", "loaders", "filters"):
        if key in frozen:
            fixture[key] = frozen[key]
    return fixture


def differences(expected, actual, path="root"):
    """Return the paths where two fixture sections disagree."""
    if isinstance(expected, dict) and isinstance(actual, dict):
        problems = []
        for key in sorted(set(expected) | set(actual)):
            if key not in expected or key not in actual:
                problems.append("%s.%s: present on one side only" % (path, key))
            else:
                problems.extend(differences(expected[key], actual[key], "%s.%s" % (path, key)))
        return problems
    if isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            return ["%s: %d entries != %d" % (path, len(expected), len(actual))]
        problems = []
        for index, (left, right) in enumerate(zip(expected, actual)):
            problems.extend(differences(left, right, "%s[%d]" % (path, index)))
        return problems
    if isinstance(expected, float) and isinstance(actual, float):
        if abs(expected - actual) > 1e-9 * max(1.0, abs(expected)):
            return ["%s: %.17g != %.17g" % (path, actual, expected)]
        return []
    return [] if expected == actual else ["%s: %r != %r" % (path, actual, expected)]


def main(argv=None):
    parser = argparse.ArgumentParser(description="regenerate the browser port's fixture")
    parser.add_argument("--check", action="store_true",
                        help="regenerate in memory and fail when the fixture is stale")
    options = parser.parse_args(argv)

    if not os.path.isfile(FIXTURE):
        raise SystemExit("%s is missing; restore it from git - it holds the sections this "
                         "script does not regenerate" % os.path.relpath(FIXTURE, REPO_ROOT))
    with open(FIXTURE, "r", encoding="utf-8") as handle:
        frozen = json.load(handle)

    current = build(frozen)
    if options.check:
        problems = []
        for key in REGENERATED:
            if key not in frozen:
                problems.append("%s: missing from the fixture" % key)
                continue
            problems.extend(differences(frozen[key], current[key], key))
        if problems:
            print("the fixture is stale - run `python tools/dump_golden.py`")
            for problem in problems[:40]:
                print("  " + problem)
            return 1
        print("fixture is current: the regenerated sections match %s" % GENERATED_BY)
        return 0

    with open(FIXTURE, "w", encoding="utf-8") as handle:
        json.dump(current, handle, indent=1)
    print("wrote %s (%.0f kB)" % (os.path.relpath(FIXTURE, REPO_ROOT),
                                  os.path.getsize(FIXTURE) / 1024.0))
    print("regenerated : %s" % ", ".join(REGENERATED))
    print("carried over: %s" % ", ".join(recorded_sections(current)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
