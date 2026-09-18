/**
 * Least squares ellipsoid fitting (Li & Griffiths, 2004) - browser port of
 * `magcal/ellipsoid.py`, using the Cholesky reformulation of the reduced eigenproblem.
 *
 * The Python tool takes the eigenvector of the non-symmetric
 * `E = C^-1 (S_11 - S_12 S_22^-1 S_21)` for its algebraically largest eigenvalue.  Instead
 * of porting a general (non-symmetric) eigensolver, this module solves the *same*
 * generalized problem `S~ v = lambda C v` symmetrically:
 *
 *     S~ = R^T R          Cholesky (S~ is positive definite for a usable capture)
 *     Chat = R^-T C R^-1  symmetric
 *     Chat u = mu u       symmetric eigenproblem, u orthonormal, mu = 1 / lambda
 *     v = R^-1 u
 *
 * `tools/compare_fit_routes.py` measures the two routes against each other: on the bundled
 * capture they agree to 1.2e-7 and on 200 noisy synthetic sweeps to 1.2e-10, with no
 * refusals - the eigenvector residual is even lower than the non-symmetric route's.  A
 * Cholesky failure means the capture does not constrain the ellipsoid in all directions,
 * which is exactly what the Python guards report.
 */

import {
  cholesky,
  dot,
  eigenvaluesSymmetric,
  inv,
  jacobiEigh,
  matmul,
  matvec,
  maxAbs,
  norm,
  solve,
  solveLowerTriangular,
  solveUpperTriangular,
  sqrtmSymmetric,
  transpose,
} from "./linalg.js";
import { LinAlgError, ValueError } from "./errors.js";

export { ValueError };

/** Fewer samples than this cannot constrain an ellipsoid (mirrors `magcal.constants`). */
export const MIN_SAMPLES = 10;

/** The `k = 4` constraint matrix of the paper (eq. 8). */
export const C_CONSTRAINT = [
  [-1, 1, 1, 0, 0, 0],
  [1, -1, 1, 0, 0, 0],
  [1, 1, -1, 0, 0, 0],
  [0, 0, 0, -4, 0, 0],
  [0, 0, 0, 0, -4, 0],
  [0, 0, 0, 0, 0, -4],
];

const AXES = "xyz";

/** Return the (N, 3) samples, rejecting the layouts `magcal.ellipsoid` rejects. */
export function validateSamples(samples, minSamples = MIN_SAMPLES) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new ValueError(
      "expected magnetometer data as an (N, 3) array of X, Y, Z samples, got an empty input",
    );
  }
  const rows = samples.map((row) => {
    const values = Array.isArray(row) || ArrayBuffer.isView(row) ? Array.from(row) : [row];
    if (values.length !== 3) {
      throw new ValueError(
        "expected magnetometer data as an (N, 3) array of X, Y, Z samples, "
        + `got shape (${samples.length}, ${values.length})`,
      );
    }
    return values.map(Number);
  });
  if (rows.length < minSamples) {
    throw new ValueError(
      `need at least ${minSamples} samples for an ellipsoid fit, got ${rows.length}`,
    );
  }
  for (const row of rows) {
    if (!row.every((value) => Number.isFinite(value))) {
      throw new ValueError("data contains NaN or infinite values; clean the capture first");
    }
  }
  const spans = [0, 1, 2].map((axis) => {
    let low = Infinity;
    let high = -Infinity;
    for (const row of rows) {
      low = Math.min(low, row[axis]);
      high = Math.max(high, row[axis]);
    }
    return high - low;
  });
  if (!spans.every((span) => span > 0)) {
    const weakest = spans.indexOf(Math.min(...spans));
    throw new ValueError(
      `axis ${AXES[weakest].toUpperCase()} never changes in this capture; rotate the sensor `
      + "through all three axes before calibrating",
    );
  }
  return rows;
}

/** Return the 10x10 scatter matrix `S = D D^T` of the design matrix (eq. 11). */
export function scatterMatrix(samples) {
  const columns = [0, 1, 2].map((axis) => samples.map((row) => row[axis]));
  const monomials = [
    columns[0].map((value) => value * value),
    columns[1].map((value) => value * value),
    columns[2].map((value) => value * value),
    columns[1].map((value, index) => 2 * value * columns[2][index]),
    columns[0].map((value, index) => 2 * value * columns[2][index]),
    columns[0].map((value, index) => 2 * value * columns[1][index]),
    columns[0].map((value) => 2 * value),
    columns[1].map((value) => 2 * value),
    columns[2].map((value) => 2 * value),
    columns[0].map(() => 1),
  ];
  const S = [];
  for (let i = 0; i < 10; i += 1) {
    S.push(new Array(10).fill(0));
  }
  for (let i = 0; i < 10; i += 1) {
    for (let j = i; j < 10; j += 1) {
      let sum = 0;
      for (let k = 0; k < monomials[i].length; k += 1) {
        sum += monomials[i][k] * monomials[j][k];
      }
      S[i][j] = sum;
      S[j][i] = sum;
    }
  }
  return S;
}

/** Return the 6x6 reduced matrix `S~ = S_11 - S_12 S_22^-1 S_21` (eq. 15 numerator). */
export function pencilMatrix(S) {
  const quadratic = S.slice(0, 6).map((row) => row.slice(0, 6));
  const mixed = S.slice(0, 6).map((row) => row.slice(6));
  const bottomLeft = S.slice(6).map((row) => row.slice(0, 6));
  const bottomRight = S.slice(6).map((row) => row.slice(6));
  const product = matmul(mixed, solve(bottomRight, bottomLeft));
  return quadratic.map((row, i) => row.map((value, j) => value - product[i][j]));
}

/** Return the fitted direction `v_1`, i.e. the eigenvector of the largest eigenvalue. */
export function fitDirection(pencil, constraint = C_CONSTRAINT) {
  const r = cholesky(pencil);                        // upper triangular, pencil = R^T R
  const rTransposed = transpose(r);
  const left = solveLowerTriangular(rTransposed, constraint);      // R^-T C
  const reduced = transpose(solveLowerTriangular(rTransposed, transpose(left)));  // R^-T C R^-1
  const { values, vectors } = jacobiEigh(reduced);
  let best = -1;
  let bestLambda = -Infinity;
  for (let k = 0; k < values.length; k += 1) {
    if (values[k] === 0) {
      continue;
    }
    const lambda = 1 / values[k];
    if (lambda > bestLambda) {
      bestLambda = lambda;
      best = k;
    }
  }
  if (best < 0) {
    throw new ValueError("degenerate ellipsoid fit; the capture is unusable");
  }
  let v = solveUpperTriangular(r, vectors.map((row) => row[best]));  // v = R^-1 u
  const length = norm(v);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new ValueError("degenerate ellipsoid fit; the capture is unusable");
  }
  v = v.map((value) => value / length);
  if (v[0] < 0) {                                    // load-bearing sign convention
    v = v.map((value) => -value);
  }
  return { direction: v, eigenvalue: bestLambda };
}

/** True when every entry of a matrix is finite. */
function isFiniteMatrix(a) {
  return a.every((row) => row.every((value) => Number.isFinite(value)));
}

/**
 * Derive the hard iron bias `b` and the soft iron matrix `A_1` from an ellipsoid fit.
 *
 * Mirrors `magcal.ellipsoid.bias_and_matrix`, including its guards and their wording: the
 * caller gets a `ValueError` explaining the capture instead of NaN/complex coefficients.
 *
 * Returns `{ hardIron, softIron, warning }` where `softIron` satisfies
 * `|A_1 (x - b)| = fieldStrength` for every sample of the capture.
 */
export function biasAndMatrix(fit, fieldStrength) {
  const { shape: m, offset, constant: d } = fit;
  if (!isFiniteMatrix(m) || !isFiniteMatrix([offset]) || !Number.isFinite(d)) {
    throw new ValueError("ellipsoid fit produced non-finite parameters; capture is unusable");
  }
  let inverse;
  try {
    inverse = inv(m);
  } catch (error) {
    throw new ValueError("singular ellipsoid fit matrix; capture is degenerate");
  }
  if (!isFiniteMatrix(inverse)) {
    throw new ValueError("ellipsoid fit matrix is not invertible; capture is degenerate");
  }
  const symmetric = inverse.map((row, i) => row.map((value, j) => (value + inverse[j][i]) / 2));
  if (!(eigenvaluesSymmetric(symmetric)[0] > 0)) {
    throw new ValueError(
      "ellipsoid fit is not positive definite: the capture does not span enough "
      + "directions for a reliable calibration",
    );
  }
  const radiusTerm = dot(matvec(inverse, offset), offset) - d;
  if (!Number.isFinite(radiusTerm) || radiusTerm <= 0) {
    throw new ValueError(
      "degenerate ellipsoid fit (non-positive radius term); capture is degenerate",
    );
  }
  let squareRoot;
  try {
    squareRoot = sqrtmSymmetric(m);
  } catch (error) {
    throw new ValueError(
      "ellipsoid fit has no real soft-iron solution; the capture does not cover all three "
      + "axes (see the coverage diagnostics)",
    );
  }
  const scale = fieldStrength / Math.sqrt(radiusTerm);
  const hardIron = matvec(inverse, offset).map((value) => -value);
  const softIron = squareRoot.map((row) => row.map((value) => value * scale));
  const tolerance = 1e-8 * (maxAbs(softIron) || 1);
  const isSymmetric = softIron.every(
    (row, i) => row.every((value, j) => Math.abs(value - softIron[j][i]) <= tolerance),
  );
  return {
    hardIron,
    softIron,
    warning: isSymmetric ? null : "soft-iron matrix is not symmetric; double-check the capture",
  };
}

/**
 * Fit a capture and derive the coefficients - the browser equivalent of
 * `magcal.calibration.build_calibration`.
 *
 * Returns `{ fieldStrength, numPoints, hardIron, softIron, warning }`.  All coordinates are
 * microTesla, as in the Python tool.
 */
export function buildCalibration(samples, fieldStrength) {
  const rows = validateSamples(samples);
  const S = scatterMatrix(rows);
  let direction;
  try {
    direction = fitDirection(pencilMatrix(S)).direction;
  } catch (error) {
    if (error instanceof LinAlgError) {
      throw new ValueError(
        "ellipsoid fit is not positive definite: the capture does not span enough "
        + "directions for a reliable calibration",
      );
    }
    throw error;
  }
  const bottomRight = S.slice(6).map((row) => row.slice(6));
  const bottomLeft = S.slice(6).map((row) => row.slice(0, 6));
  const v2 = matvec(solve(bottomRight, bottomLeft), direction).map((value) => -value);
  const fit = {
    shape: [
      [direction[0], direction[5], direction[4]],
      [direction[5], direction[1], direction[3]],
      [direction[4], direction[3], direction[2]],
    ],
    offset: [v2[0], v2[1], v2[2]],
    constant: v2[3],
  };
  const { hardIron, softIron, warning } = biasAndMatrix(fit, fieldStrength);
  return {
    fieldStrength: Number(fieldStrength),
    numPoints: rows.length,
    hardIron,
    softIron,
    warning,
  };
}

/** Return `A_1 (x - b)`, i.e. one calibrated sample (mirrors `Calibration.apply`). */
export function applyCalibration(calibration, sample) {
  const centred = sample.map((value, index) => value - calibration.hardIron[index]);
  return calibration.softIron.map((axis) => axis.reduce(
    (sum, value, index) => sum + value * centred[index], 0,
  ));
}

/** Return the calibrated samples of a whole capture. */
export function applyCalibrationAll(calibration, samples) {
  return samples.map((sample) => applyCalibration(calibration, sample));
}
