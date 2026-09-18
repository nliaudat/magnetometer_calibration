/**
 * Parity checks for the dependency-free browser port.
 *
 * The same assertions run in three places, so the port cannot drift from the tool:
 *   - `web/tests/parity.html`      browser (open it, or use tools/run_web_tests.py)
 *   - `web/tests/parity.test.mjs`  node --test, used by CI
 *   - `tools/run_web_tests.py`     headless Chrome/Edge, for machines without Node
 *
 * Every expectation comes from `web/tests/golden/python-golden.json`, which
 * `tools/dump_golden.py` generates with the Python implementation itself.
 */

import { applyCalibrationAll, buildCalibration } from "../js/fit.js";
import { evaluate, formatDiagnostics, formatHeading, headingStatistics } from "../js/diagnostics.js";
import { filterSamples, parseSamples } from "../js/loaders.js";
import { formatGauss, formatSix } from "../js/format.js";
import { renderCCode, renderEsphomeLambda, renderJsonBlock } from "../js/export.js";

/**
 * The port solves the reduced eigenproblem symmetrically (Cholesky + Jacobi) instead of
 * using a general eigensolver, which `tools/compare_fit_routes.py` measures at 1.2e-7 on the
 * bundled capture and 1.2e-10 on noisy synthetic sweeps.
 */
export const RELATIVE_TOLERANCE = 1e-6;

/** Largest absolute difference divided by the magnitude of the expectation. */
export function relativeDelta(actual, expected) {
  const left = Array.isArray(actual) ? actual.flat(Infinity) : [actual];
  const right = Array.isArray(expected) ? expected.flat(Infinity) : [expected];
  const scale = Math.max(...right.map(Math.abs), 1e-300);
  let worst = 0;
  left.forEach((value, index) => {
    worst = Math.max(worst, Math.abs(value - right[index]));
  });
  return worst / scale;
}

/** Return `A_1 (x - b)`, i.e. one calibrated sample. */
export function applyCalibration(fit, sample) {
  const centred = sample.map((value, index) => value - fit.hardIron[index]);
  return fit.softIron.map((axis) => axis.reduce(
    (sum, value, index) => sum + value * centred[index], 0,
  ));
}

/** Return the tool's quality metric: RMS of `|B|` against the expected field, in percent. */
export function percentError(fit, samples, field) {
  let total = 0;
  samples.forEach((sample) => {
    const magnitude = Math.hypot(...applyCalibration(fit, sample));
    total += (magnitude - field) ** 2;
  });
  return (100 * Math.sqrt(total / samples.length)) / Math.abs(field);
}

/** Return the population standard deviation of the calibrated magnitudes. */
export function magnitudeSpread(fit, samples) {
  const magnitudes = samples.map((sample) => Math.hypot(...applyCalibration(fit, sample)));
  const mean = magnitudes.reduce((sum, value) => sum + value, 0) / magnitudes.length;
  return Math.sqrt(magnitudes.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / magnitudes.length);
}

/** Return the first difference between two multi-line strings, for failure messages. */
export function firstDifference(actual, expected) {
  const left = String(actual).split("\n");
  const right = String(expected).split("\n");
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      return `line ${index + 1}: expected ${JSON.stringify(right[index])}, `
        + `got ${JSON.stringify(left[index])}`;
    }
  }
  return "the strings differ in length only";
}

/**
 * Run every check against a loaded fixture and return `[{ name, ok, detail }]`.
 *
 * No check throws, so a browser page can render the whole report instead of stopping at the
 * first failure.
 */
export function runTests(fixture) {
  const results = [];
  const check = (name, ok, detail) => {
    results.push({
      name,
      ok: Boolean(ok),
      detail: ok ? "" : String(detail === undefined ? "" : detail),
    });
  };
  checkFormatting(fixture, check);
  checkReference(fixture, check);
  checkDiagnostics(fixture, check);
  checkLoaders(fixture, check);
  checkSynthetic(fixture, check);
  checkRejections(fixture, check);
  checkExports(fixture, check);
  return results;
}

/** The `%.6f` / `%.12g` battery: pins the formatters against Python's own output. */
function checkFormatting(fixture, check) {
  fixture.formatting.six_decimals.forEach(([value, expected]) => {
    const actual = formatSix(value);
    check(`formatSix(${value}) == ${expected}`, actual === expected,
      `got ${JSON.stringify(actual)}`);
  });
  fixture.formatting.twelve_g.forEach(([value, expected]) => {
    const actual = formatGauss(value, 12);
    check(`formatGauss(${value}) == ${expected}`, actual === expected,
      `got ${JSON.stringify(actual)}`);
  });
}

/** The bundled capture: coefficients, the committed report and the physics invariants. */
function checkReference(fixture, check) {
  const reference = fixture.reference;
  let fit = null;
  try {
    fit = buildCalibration(reference.samples, reference.field);
    check("reference: the fit succeeds", true);
  } catch (error) {
    check("reference: the fit succeeds", false, error && error.message);
    return;
  }
  const biasDelta = relativeDelta(fit.hardIron, reference.hard_iron);
  const matrixDelta = relativeDelta(fit.softIron, reference.soft_iron);
  check("reference: hard iron matches the Python fit", biasDelta <= RELATIVE_TOLERANCE,
    `delta ${biasDelta.toExponential(2)}: ${fit.hardIron} vs ${reference.hard_iron}`);
  check("reference: soft iron matches the Python fit", matrixDelta <= RELATIVE_TOLERANCE,
    `delta ${matrixDelta.toExponential(2)}`);
  const reportBias = relativeDelta(fit.hardIron, reference.hard_iron);
  check("reference: hard iron matches calibrate.py", reportBias <= RELATIVE_TOLERANCE,
    `delta ${reportBias.toExponential(2)}`);
  const error = percentError(fit, reference.samples, reference.field);
  check("reference: residual matches the CLI",
    Math.abs(error - reference.percent_error) <= 0.05,
    `${error.toFixed(4)}% vs ${reference.percent_error.toFixed(4)}%`);
  check("reference: residual is below the 5% target", error <= 5.0, `${error.toFixed(3)}%`);
  const spread = magnitudeSpread(fit, reference.samples);
  check("reference: the calibrated |B| is constant", spread <= 0.01 * reference.field,
    `spread ${spread.toFixed(3)} uT`);
  check("reference: the soft-iron matrix is symmetric",
    relativeDelta([fit.softIron[0][1], fit.softIron[0][2], fit.softIron[1][2]],
      [fit.softIron[1][0], fit.softIron[2][0], fit.softIron[2][1]]) <= 1e-9);
  check("reference: the soft-iron diagonal is positive",
    fit.softIron.every((row, index) => row[index] > 0));
}

/** The quality report and the heading report: numbers and rendered text. */
function checkDiagnostics(fixture, check) {
  const expected = fixture.diagnostics.numbers;
  const samples = fixture.reference.samples;
  const field = fixture.reference.field;
  let calibrated = null;
  let report = null;
  try {
    const fit = buildCalibration(samples, field);
    calibrated = applyCalibrationAll(fit, samples);
    report = evaluate(samples, calibrated, field);
    check("diagnostics: evaluate succeeds", true);
  } catch (error) {
    check("diagnostics: evaluate succeeds", false, error && error.message);
    return;
  }
  const compare = (label, actual, wanted, tolerance) => {
    const delta = relativeDelta(actual, wanted);
    check(label, delta <= tolerance,
      `delta ${delta.toExponential(2)}: ${JSON.stringify(actual)} vs ${JSON.stringify(wanted)}`);
  };
  compare("diagnostics: target field strength", [report.targetFieldStrength],
    [expected.target_field_strength], 1e-12);
  compare("diagnostics: raw magnitude stats",
    [report.raw.mean, report.raw.std, report.raw.min, report.raw.max, report.raw.rmsError],
    [expected.raw.mean, expected.raw.std, expected.raw.min, expected.raw.max,
      expected.raw.rms_error], 1e-9);
  compare("diagnostics: axis spans",
    [report.axisSpansRaw.x, report.axisSpansRaw.y, report.axisSpansRaw.z],
    [expected.axis_spans_raw.x, expected.axis_spans_raw.y, expected.axis_spans_raw.z], 1e-9);
  compare("diagnostics: coverage ratio", [report.coverageRatio],
    [expected.coverage_ratio], 1e-9);
  compare("diagnostics: covariance eigenvalues", report.covarianceEigenvalues,
    expected.covariance_eigenvalues, 1e-9);
  compare("diagnostics: condition number", [report.conditionNumber],
    [expected.condition_number], 1e-9);
  compare("diagnostics: calibrated magnitude stats",
    [report.calibrated.mean, report.calibrated.std, report.calibrated.min, report.calibrated.max,
      report.calibrated.rmsError],
    [expected.calibrated.mean, expected.calibrated.std, expected.calibrated.min,
      expected.calibrated.max, expected.calibrated.rms_error], 1e-6);
  compare("diagnostics: residual percent", [report.percentError],
    [expected.percent_error], 1e-6);
  check("diagnostics: the pass/fail verdict matches", report.passed === expected.passed);
  check("diagnostics: the warning text matches",
    JSON.stringify(report.warnings) === JSON.stringify(expected.warnings),
    JSON.stringify(report.warnings));
  const text = formatDiagnostics(report);
  check("diagnostics: the text report is identical", text === fixture.diagnostics.text,
    firstDifference(text, fixture.diagnostics.text));
  const headingText = formatHeading(headingStatistics(samples, calibrated, 0.0));
  check("diagnostics: the heading report is identical",
    headingText === fixture.diagnostics.heading_text,
    firstDifference(headingText, fixture.diagnostics.heading_text));
}

/** Six seeded synthetic sweeps: full, sparse, noisy and weak-axis captures. */
function checkSynthetic(fixture, check) {
  fixture.synthetic.forEach((capture) => {
    let fit = null;
    try {
      fit = buildCalibration(capture.samples, capture.field);
    } catch (error) {
      check(`synthetic ${capture.label}: the fit succeeds`, false, error && error.message);
      return;
    }
    const biasDelta = relativeDelta(fit.hardIron, capture.hard_iron);
    const matrixDelta = relativeDelta(fit.softIron, capture.soft_iron);
    check(`synthetic ${capture.label}: coefficients match Python`,
      biasDelta <= RELATIVE_TOLERANCE && matrixDelta <= RELATIVE_TOLERANCE,
      `bias ${biasDelta.toExponential(2)}, matrix ${matrixDelta.toExponential(2)}`);
    const error = percentError(fit, capture.samples, capture.field);
    check(`synthetic ${capture.label}: the residual matches the CLI`,
      Math.abs(error - capture.percent_error) <= Math.max(0.05, 0.02 * capture.percent_error),
      `${error.toFixed(4)}% vs ${capture.percent_error.toFixed(4)}%`);
  });
}

/** Captures the tool documents as unusable: the port must refuse them with a clear reason. */
function checkRejections(fixture, check) {
  fixture.rejections.forEach((capture) => {
    let message = null;
    try {
      buildCalibration(capture.samples, capture.field);
    } catch (error) {
      message = error && error.message ? error.message : String(error);
    }
    if (message === null) {
      check(`rejection ${capture.label}: refused`, false, "the port accepted the capture");
      return;
    }
    check(`rejection ${capture.label}: refused with a helpful message`,
      message.includes(capture.message_contains),
      `expected a message containing ${JSON.stringify(capture.message_contains)}, `
      + `got ${JSON.stringify(message)}`);
  });
}

/** The C / JSON / ESPHome text: byte identical for the committed golden coefficients. */
function checkExports(fixture, check) {
  const golden = {
    fieldStrength: fixture.blocks.calibration.field,
    hardIron: fixture.blocks.calibration.hard_iron,
    softIron: fixture.blocks.calibration.soft_iron,
  };
  const cCode = renderCCode(golden);
  check("export: the C block is byte identical", cCode === fixture.blocks.c_code,
    firstDifference(cCode, fixture.blocks.c_code));
  const lambda = renderEsphomeLambda(golden);
  check("export: the ESPHome lambda is byte identical",
    lambda === fixture.blocks.esphome_lambda,
    firstDifference(lambda, fixture.blocks.esphome_lambda));
  const withDeclination = renderEsphomeLambda(golden, { declination: 2.5 });
  check("export: the ESPHome lambda with declination is byte identical",
    withDeclination === fixture.blocks.esphome_lambda_declination,
    firstDifference(withDeclination, fixture.blocks.esphome_lambda_declination));
  const block = renderJsonBlock(golden);
  const payload = JSON.parse(block.slice(block.indexOf("{"), block.lastIndexOf("}") + 1));
  const expectedPayload = {
    hard_iron_bias: fixture.blocks.calibration.hard_iron,
    soft_iron_matrix: fixture.blocks.calibration.soft_iron,
    magnetic_field_strength: fixture.blocks.calibration.field,
    unit: "microtesla",
  };
  check("export: the JSON block matches",
    JSON.stringify(payload) === JSON.stringify(expectedPayload), JSON.stringify(payload));
  const numbers = (cCode.match(/[-+]?\d+\.\d{6}/g) || []).map(Number);
  const coefficients = [...golden.hardIron, ...golden.softIron.flat()];
  check("export: the C block carries all 12 coefficients", numbers.length === 12,
    `${numbers.length} numbers`);
  check("export: the C block numbers match the calibration",
    relativeDelta(numbers, coefficients) <= 1e-6,
    `delta ${relativeDelta(numbers, coefficients).toExponential(2)}`);
}

/** Return an object's key/value pairs sorted by key so two reports can be compared as text. */
function sortedEntries(object) {
  return Object.keys(object).sort().map((key) => [key, object[key]]);
}

/** Parsing and filtering: the loader must make the same sense of a capture as the CLI does. */
function checkLoaders(fixture, check) {
  fixture.loaders.forEach((capture) => {
    let samples = null;
    let report = null;
    let message = null;
    try {
      [samples, report] = parseSamples(capture.text, capture.pattern || null);
    } catch (error) {
      message = error && error.message ? error.message : String(error);
    }
    if (capture.error) {
      check(`loader ${capture.label}: refused with the CLI's message`,
        message === capture.error,
        `expected ${JSON.stringify(capture.error)}, got ${JSON.stringify(message)}`);
      return;
    }
    if (message !== null) {
      check(`loader ${capture.label}: parses`, false, message);
      return;
    }
    const delta = relativeDelta(samples, capture.samples);
    check(`loader ${capture.label}: samples match`, delta <= 1e-12,
      `delta ${delta.toExponential(2)}: ${JSON.stringify(samples)} `
      + `vs ${JSON.stringify(capture.samples)}`);
    const actual = JSON.stringify(sortedEntries(report));
    const expected = JSON.stringify(sortedEntries(capture.report));
    check(`loader ${capture.label}: the parse report matches`, actual === expected,
      `\n    actual   ${actual}\n    expected ${expected}`);
  });
  fixture.filters.forEach((entry) => {
    const [filtered, report] = filterSamples(fixture.reference.samples, entry.min_delta,
      entry.max_points, 0);
    const matches = report.after_min_delta === entry.report.after_min_delta
      && report.min_delta === entry.report.min_delta
      && report.kept === entry.report.kept
      && report.subsampled === entry.report.subsampled
      && report.max_points === entry.report.max_points;
    check(`filter ${entry.label}: the report matches`, matches,
      `${JSON.stringify(report)} vs ${JSON.stringify(entry.report)}`);
    check(`filter ${entry.label}: keeps the expected number of samples`,
      filtered.length === entry.report.kept,
      `${filtered.length} vs ${entry.report.kept}`);
  });
}
