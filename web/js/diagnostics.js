/**
 * Calibration diagnostics - browser port of `magcal/diagnostics.py`.
 *
 * `evaluate` is the quality metric the tool is built around: after a correct calibration
 * `|B|` is constant and equal to the expected field strength, so the RMS residual of the
 * calibrated samples is the pass/fail number.  The coverage ratio (`min/max` axis span) says
 * whether the capture constrained all three axes at all.
 */

import { applyCalibration } from "./fit.js";
import { formatGauss } from "./format.js";
import { jacobiEigh } from "./linalg.js";

export const DEFAULT_MAX_ERROR_PERCENT = 5.0;
export const COVERAGE_WARN_RATIO = 0.3;
const AXES = "xyz";

/** Circle-safe statistics of one magnitude series. */
export function magnitudeStats(samples, fieldStrength, transform) {
  const magnitudes = samples.map((sample) => Math.hypot(...(transform ? transform(sample) : sample)));
  const mean = magnitudes.reduce((sum, value) => sum + value, 0) / magnitudes.length;
  let squared = 0;
  magnitudes.forEach((value) => {
    squared += (value - fieldStrength) ** 2;
  });
  const rms = Math.sqrt(squared / magnitudes.length);
  let spread = 0;
  magnitudes.forEach((value) => {
    spread += (value - mean) ** 2;
  });
  return {
    mean,
    std: Math.sqrt(spread / magnitudes.length),
    min: Math.min(...magnitudes),
    max: Math.max(...magnitudes),
    rmsError: rms,
    percentError: fieldStrength ? (100 * rms) / Math.abs(fieldStrength) : null,
  };
}

/** Return the per-axis span and the coverage ratio of a capture. */
export function axisSpans(samples) {
  const spans = [0, 1, 2].map((axis) => {
    let low = Infinity;
    let high = -Infinity;
    samples.forEach((sample) => {
      low = Math.min(low, sample[axis]);
      high = Math.max(high, sample[axis]);
    });
    return high - low;
  });
  const widest = Math.max(...spans);
  return {
    spans,
    coverageRatio: widest > 0 ? Math.min(...spans) / widest : 0,
  };
}

/**
 * Return the eigenvalues of the sample covariance matrix, largest first.
 *
 * `numpy.cov` (which `magcal.diagnostics.evaluate` uses) is the *unbiased* estimator, so the
 * divisor is `N - 1` - a difference of 0.4% on a 243 sample capture, far too large to hide
 * behind a tolerance.
 */
export function covarianceEigenvalues(samples) {
  const count = samples.length;
  const divisor = count > 1 ? count - 1 : 1;
  const means = [0, 1, 2].map(
    (axis) => samples.reduce((sum, sample) => sum + sample[axis], 0) / count,
  );
  const covariance = [0, 1, 2].map((i) => [0, 1, 2].map((j) => {
    let total = 0;
    samples.forEach((sample) => {
      total += (sample[i] - means[i]) * (sample[j] - means[j]);
    });
    return total / divisor;
  }));
  return jacobiEigh(covariance).values.slice().reverse();
}

/**
 * Score a capture against the expected field strength (`magcal.diagnostics.evaluate`).
 *
 * `calibrated` is optional: without it the raw numbers are reported, with it the residual
 * of the calibrated samples is the classic quality metric.  The coverage ratio says whether
 * the capture constrained all three axes, and `passed` mirrors `--strict`.
 */
export function evaluate(samples, calibrated = null, fieldStrength = null,
  maxErrorPercent = DEFAULT_MAX_ERROR_PERCENT) {
  if (fieldStrength === null || fieldStrength === undefined) {
    throw new Error("field_strength is required to evaluate a capture");
  }
  const { spans, coverageRatio } = axisSpans(samples);
  const eigenvalues = covarianceEigenvalues(samples);
  const smallest = eigenvalues[eigenvalues.length - 1];
  const diagnostics = {
    targetFieldStrength: Number(fieldStrength),
    raw: magnitudeStats(samples, fieldStrength),
    axisSpansRaw: { x: spans[0], y: spans[1], z: spans[2] },
    coverageRatio,
    covarianceEigenvalues: eigenvalues,
    conditionNumber: smallest > 0 ? eigenvalues[0] / smallest : null,
    maxErrorPercent: Number(maxErrorPercent),
    calibrated: calibrated === null ? null : magnitudeStats(calibrated, fieldStrength),
    warnings: [],
  };
  const measured = diagnostics.calibrated || diagnostics.raw;
  diagnostics.percentError = measured.percentError;
  diagnostics.passed = measured.percentError !== null
    && measured.percentError <= maxErrorPercent;
  if (coverageRatio < COVERAGE_WARN_RATIO) {
    const weakest = spans.indexOf(Math.min(...spans));
    diagnostics.warnings.push(
      `${AXES[weakest].toUpperCase()} axis span is only ${(100 * coverageRatio).toFixed(1)}% `
      + "of the widest axis; the ellipsoid fit is poorly constrained - redo the capture "
      + "rotating the sensor through all three axes",
    );
  }
  if (calibrated !== null && !diagnostics.passed) {
    diagnostics.warnings.push(
      `residual error ${measured.percentError.toFixed(2)}% exceeds the `
      + `${maxErrorPercent.toFixed(2)}% target`,
    );
  }
  return diagnostics;
}

/** Circular mean and dispersion of an angle series, in degrees. */
export function circularStats(degrees) {
  const radians = degrees.map((value) => (value * Math.PI) / 180);
  const meanSin = radians.reduce((sum, value) => sum + Math.sin(value), 0) / radians.length;
  const meanCos = radians.reduce((sum, value) => sum + Math.cos(value), 0) / radians.length;
  const resultant = Math.hypot(meanSin, meanCos);
  return {
    circular_mean_deg: (((Math.atan2(meanSin, meanCos) * 180) / Math.PI) + 360) % 360,
    circular_std_deg: (Math.sqrt(-2 * Math.log(Math.max(resultant, 1e-12))) * 180) / Math.PI,
  };
}

/**
 * Heading statistics using the HMC5883L convention `atan2(0 - x, y)`.
 *
 * Heading is independent of the field strength (it only scales the magnitude); the
 * calibration matters because of the off-diagonal soft-iron cross-talk terms.
 */
export function headingStatistics(samples, calibrated = null, declination = 0) {
  const degrees = (value) => (value * 180) / Math.PI;
  const normalise = (value) => ((value % 360) + 360) % 360;
  const rawHeading = samples.map((sample) => normalise(degrees(Math.atan2(-sample[0], sample[1]))));
  const report = {
    declination_deg: Number(declination),
    convention: "atan2(0 - x, y) (HMC5883L)",
    raw: circularStats(rawHeading),
  };
  if (calibrated !== null) {
    const trueHeading = calibrated.map((sample) => normalise(
      degrees(Math.atan2(-sample[0], sample[1])) + Number(declination),
    ));
    const differences = trueHeading.map(
      (value, index) => (((value - rawHeading[index] + 180) % 360) + 360) % 360 - 180,
    );
    const mean = differences.reduce((sum, value) => sum + value, 0) / differences.length;
    const variance = differences.reduce((sum, value) => sum + (value - mean) ** 2, 0)
      / differences.length;
    report.calibrated_true = circularStats(trueHeading);
    report.shift_calibrated_minus_raw_deg = {
      mean,
      std: Math.sqrt(variance),
      max_abs: Math.max(...differences.map(Math.abs)),
    };
  }
  return report;
}

/** Render a residual/coverage report as human readable text (the CLI's `--report text`). */
export function formatDiagnostics(report) {
  const raw = report.raw;
  const calibrated = report.calibrated || null;
  const lines = [
    "",
    "Calibration quality (target |B| = "
      + `${formatGauss(report.targetFieldStrength, 12)} microTesla):`,
    `  ${"".padEnd(22)}${"raw".padStart(12)}${calibrated ? "calibrated".padStart(14) : ""}`,
  ];
  const addRow = (label, key) => {
    let line = `  ${label.padEnd(22)}${raw[key].toFixed(2).padStart(12)}`;
    if (calibrated) {
      line += calibrated[key].toFixed(2).padStart(14);
    }
    lines.push(line);
  };
  addRow("|B| mean", "mean");
  addRow("|B| std", "std");
  addRow("|B| min", "min");
  addRow("|B| max", "max");
  addRow("RMS error", "rmsError");
  addRow("error %", "percentError");
  const spans = report.axisSpansRaw;
  lines.push(`  ${"axis spans (raw)".padEnd(24)}`
    + AXES.split("").map((axis) => `${axis.toUpperCase()}=${spans[axis].toFixed(1)}`).join(", "));
  lines.push(`  ${"coverage (min/max span)".padEnd(24)}${(100 * report.coverageRatio).toFixed(1)}%`);
  if (report.conditionNumber) {
    lines.push(`  ${"covariance condition".padEnd(24)}${report.conditionNumber.toFixed(1)}`);
  }
  lines.push(`  ${"result".padEnd(24)}${report.passed ? "PASS" : "FAIL"}`);
  report.warnings.forEach((warning) => {
    lines.push(`  warning: ${warning}`);
  });
  lines.push("");
  return lines.join("\n");
}

/** Render a heading report as human readable text (`magcal.diagnostics.format_heading`). */
export function formatHeading(report) {
  const raw = report.raw;
  const lines = [
    "",
    `Heading report (declination ${formatGauss(report.declination_deg, 12)} deg, `
      + `convention ${report.convention}):`,
    `  ${"raw".padEnd(34)} mean ${raw.circular_mean_deg.toFixed(2).padStart(7)} deg, `
      + `spread ${raw.circular_std_deg.toFixed(2).padStart(6)} deg`,
  ];
  if (report.calibrated_true) {
    const calibrated = report.calibrated_true;
    const shift = report.shift_calibrated_minus_raw_deg;
    lines.push(`  ${"calibrated + declination".padEnd(34)} mean `
      + `${calibrated.circular_mean_deg.toFixed(2).padStart(7)} deg, `
      + `spread ${calibrated.circular_std_deg.toFixed(2).padStart(6)} deg`);
    lines.push(`  ${"shift (calibrated - raw)".padEnd(34)} mean `
      + `${shift.mean.toFixed(2).padStart(7)} deg, max ${shift.max_abs.toFixed(2).padStart(6)} deg`);
  }
  lines.push("");
  return lines.join("\n");
}
