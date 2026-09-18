/**
 * Dense linear algebra for the magnetometer calibration port.
 *
 * Every matrix is a plain array of arrays of `Number`, so the code runs unchanged in a
 * browser, in Node and in a test harness.  The sizes are tiny (3x3, 4x4, 6x6, 10x10), so
 * simple, auditable algorithms are preferred over anything clever: the whole point is to
 * reproduce what `numpy.linalg` / `scipy.linalg` do in `magcal/ellipsoid.py`.
 *
 * Conventions used throughout:
 *   - `Float64Array`-free nested arrays: `[[a, b], [c, d]]` is row-major.
 *   - indices are 0 based, `a[i][j]` is row `i`, column `j`.
 *   - the Cholesky factor is returned **upper triangular** (`a = R^T R`), matching
 *     `numpy.linalg.cholesky(a).T`, which is how `tools/compare_fit_routes.py` derives the
 *     symmetric reformulation of the ellipsoid fit.
 */

/** Raised when a decomposition fails (singular or not positive definite). */
import { LinAlgError } from "./errors.js";

export { LinAlgError };

/** Return an `n` by `m` (default `n` by `n`) matrix of zeros. */
export function zeros(n, m = n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(new Array(m).fill(0));
  }
  return out;
}

/** Return the `n` by `n` identity matrix. */
export function identity(n) {
  const out = zeros(n);
  for (let i = 0; i < n; i += 1) {
    out[i][i] = 1;
  }
  return out;
}

/** Return a copy of a matrix (row by row, so the rows are independent arrays). */
export function cloneMatrix(a) {
  return a.map((row) => row.slice());
}

/** Return the transpose of a matrix. */
export function transpose(a) {
  const out = zeros(a[0].length, a.length);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < a[0].length; j += 1) {
      out[j][i] = a[i][j];
    }
  }
  return out;
}

/** Return the matrix product `a @ b`. */
export function matmul(a, b) {
  const n = a.length;
  const k = b.length;
  const m = b[0].length;
  const out = zeros(n, m);
  for (let i = 0; i < n; i += 1) {
    for (let p = 0; p < k; p += 1) {
      const factor = a[i][p];
      if (factor === 0) {
        continue;
      }
      const row = b[p];
      for (let j = 0; j < m; j += 1) {
        out[i][j] += factor * row[j];
      }
    }
  }
  return out;
}

/** Return the matrix-vector product `a @ x` as a new array. */
export function matvec(a, x) {
  const out = new Array(a.length).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < x.length; j += 1) {
      sum += a[i][j] * x[j];
    }
    out[i] = sum;
  }
  return out;
}

/** Return the dot product of two vectors. */
export function dot(x, y) {
  let sum = 0;
  for (let i = 0; i < x.length; i += 1) {
    sum += x[i] * y[i];
  }
  return sum;
}

/** Return the Euclidean norm of a vector. */
export function norm(x) {
  return Math.sqrt(dot(x, x));
}

/** Return a scaled copy of a vector. */
export function scaled(x, factor) {
  return x.map((value) => value * factor);
}

/** Return the Frobenius norm of a matrix. */
export function frobenius(a) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < a[0].length; j += 1) {
      sum += a[i][j] * a[i][j];
    }
  }
  return Math.sqrt(sum);
}

/** Return the largest absolute entry of a matrix (0 for an empty matrix). */
export function maxAbs(a) {
  let best = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < a[0].length; j += 1) {
      best = Math.max(best, Math.abs(a[i][j]));
    }
  }
  return best;
}

/** Return true when every entry of a matrix is finite. */
export function isFiniteMatrix(a) {
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < a[0].length; j += 1) {
      if (!Number.isFinite(a[i][j])) {
        return false;
      }
    }
  }
  return true;
}

/** Return the right hand side of a linear solve as `[[...], ...]` (n, k). */
function asColumns(b) {
  if (Array.isArray(b[0])) {
    return cloneMatrix(b);
  }
  return b.map((value) => [value]);
}

/** Return column `j` of a solution matrix as a vector (or the only column). */
function takeSolution(solution, width) {
  if (width === 1) {
    return solution.map((row) => row[0]);
  }
  return solution;
}

/**
 * Solve `a x = b` with LU decomposition and partial pivoting.
 *
 * `b` is a vector `(n,)` or a matrix `(n, k)`; the result has the same shape.  Raises
 * `LinAlgError` when `a` is singular, which is the browser equivalent of the
 * `scipy.linalg.LinAlgError` that `magcal` reports as a degenerate capture.
 */
export function solve(a, b) {
  const n = a.length;
  const lu = cloneMatrix(a);
  const rhs = asColumns(b);
  const width = rhs[0].length;
  const order = [];
  for (let index = 0; index < n; index += 1) {
    order.push(index);
  }

  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    let best = Math.abs(lu[column][column]);
    for (let row = column + 1; row < n; row += 1) {
      const candidate = Math.abs(lu[row][column]);
      if (candidate > best) {
        best = candidate;
        pivot = row;
      }
    }
    if (best === 0) {
      throw new LinAlgError("singular matrix");
    }
    if (pivot !== column) {
      const swappedRow = lu[column];
      lu[column] = lu[pivot];
      lu[pivot] = swappedRow;
      const swappedIndex = order[column];
      order[column] = order[pivot];
      order[pivot] = swappedIndex;
    }
    for (let row = column + 1; row < n; row += 1) {
      const factor = lu[row][column] / lu[column][column];
      lu[row][column] = factor;
      for (let j = column + 1; j < n; j += 1) {
        lu[row][j] -= factor * lu[column][j];
      }
    }
  }

  const x = order.map((row) => rhs[row].slice());
  for (let i = 1; i < n; i += 1) {
    for (let k = 0; k < i; k += 1) {
      const factor = lu[i][k];
      if (factor !== 0) {
        for (let j = 0; j < width; j += 1) {
          x[i][j] -= factor * x[k][j];
        }
      }
    }
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let k = i + 1; k < n; k += 1) {
      const factor = lu[i][k];
      if (factor !== 0) {
        for (let j = 0; j < width; j += 1) {
          x[i][j] -= factor * x[k][j];
        }
      }
    }
    const pivot = lu[i][i];
    if (pivot === 0) {
      throw new LinAlgError("singular matrix");
    }
    for (let j = 0; j < width; j += 1) {
      x[i][j] /= pivot;
    }
  }
  return takeSolution(x, width);
}

/** Return the inverse of `a` (Gauss-Jordan elimination with partial pivoting). */
export function inv(a) {
  const n = a.length;
  const work = a.map((row, index) => row.concat(identity(n)[index]));
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    let best = Math.abs(work[column][column]);
    for (let row = column + 1; row < n; row += 1) {
      const candidate = Math.abs(work[row][column]);
      if (candidate > best) {
        best = candidate;
        pivot = row;
      }
    }
    if (best === 0) {
      throw new LinAlgError("singular matrix");
    }
    if (pivot !== column) {
      const swapped = work[column];
      work[column] = work[pivot];
      work[pivot] = swapped;
    }
    const diagonal = work[column][column];
    for (let j = 0; j < 2 * n; j += 1) {
      work[column][j] /= diagonal;
    }
    for (let row = 0; row < n; row += 1) {
      if (row === column) {
        continue;
      }
      const factor = work[row][column];
      if (factor === 0) {
        continue;
      }
      for (let j = 0; j < 2 * n; j += 1) {
        work[row][j] -= factor * work[column][j];
      }
    }
  }
  return work.map((row) => row.slice(n));
}

/** Solve `l x = b` for a lower triangular `l` (vector or `(n, k)` right hand side). */
export function solveLowerTriangular(l, b) {
  const n = l.length;
  const rhs = asColumns(b);
  const width = rhs[0].length;
  const x = rhs.map((row) => row.slice());
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < i; k += 1) {
      const factor = l[i][k];
      if (factor !== 0) {
        for (let j = 0; j < width; j += 1) {
          x[i][j] -= factor * x[k][j];
        }
      }
    }
    const pivot = l[i][i];
    if (pivot === 0) {
      throw new LinAlgError("singular triangular matrix");
    }
    for (let j = 0; j < width; j += 1) {
      x[i][j] /= pivot;
    }
  }
  return takeSolution(x, width);
}

/** Solve `u x = b` for an upper triangular `u` (vector or `(n, k)` right hand side). */
export function solveUpperTriangular(u, b) {
  const n = u.length;
  const rhs = asColumns(b);
  const width = rhs[0].length;
  const x = rhs.map((row) => row.slice());
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let k = i + 1; k < n; k += 1) {
      const factor = u[i][k];
      if (factor !== 0) {
        for (let j = 0; j < width; j += 1) {
          x[i][j] -= factor * x[k][j];
        }
      }
    }
    const pivot = u[i][i];
    if (pivot === 0) {
      throw new LinAlgError("singular triangular matrix");
    }
    for (let j = 0; j < width; j += 1) {
      x[i][j] /= pivot;
    }
  }
  return takeSolution(x, width);
}

/**
 * Return the upper triangular Cholesky factor `R` of a symmetric matrix, `a = R^T R`.
 *
 * Matches `numpy.linalg.cholesky(a).T`: the factor is upper triangular so the symmetric
 * reformulation in `fit.js` reads exactly like the Python prototype.  Raises `LinAlgError`
 * when `a` is not positive definite - the port's way of detecting a capture that does not
 * constrain the ellipsoid in all three directions.
 */
export function cholesky(a) {
  const n = a.length;
  const r = zeros(n);
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let sum = a[i][j];
      for (let k = 0; k < i; k += 1) {
        sum -= r[k][i] * r[k][j];
      }
      if (i === j) {
        if (!(sum > 0) || !Number.isFinite(sum)) {
          throw new LinAlgError("matrix is not positive definite");
        }
        r[i][j] = Math.sqrt(sum);
      } else {
        r[i][j] = sum / r[i][i];
      }
    }
  }
  return r;
}

/**
 * Jacobi eigenvalue decomposition of a symmetric matrix.
 *
 * Returns `{ values, vectors }` with the eigenvalues sorted ascending and column `j` of
 * `vectors` belonging to `values[j]` - the contract of `numpy.linalg.eigh`, which the
 * diagnostics use for `eigvalsh`/`cov`.  Classical cyclic Jacobi with an exact rotation per
 * (p, q) pair: for 3x3..10x10 matrices it converges in a handful of sweeps to machine
 * precision and cannot fail, unlike QR on a nearly singular matrix.
 */
export function jacobiEigh(a, { maxSweeps = 100, tolerance = 1e-16 } = {}) {
  const n = a.length;
  const work = cloneMatrix(a);
  const vectors = identity(n);
  const scale = frobenius(a) || 1;

  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let offDiagonal = 0;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = work[p][q];
        offDiagonal += apq * apq;
        if (apq === 0) {
          continue;
        }
        const theta = (work[q][q] - work[p][p]) / (2 * apq);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = work[k][p];
          const akq = work[k][q];
          work[k][p] = c * akp - s * akq;
          work[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = work[p][k];
          const aqk = work[q][k];
          work[p][k] = c * apk - s * aqk;
          work[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = vectors[k][p];
          const vkq = vectors[k][q];
          vectors[k][p] = c * vkp - s * vkq;
          vectors[k][q] = s * vkp + c * vkq;
        }
      }
    }
    if (Math.sqrt(2 * offDiagonal) <= tolerance * scale) {
      break;
    }
  }

  const order = [];
  for (let i = 0; i < n; i += 1) {
    order.push(i);
  }
  order.sort((left, right) => work[left][left] - work[right][right]);
  const values = order.map((index) => work[index][index]);
  const sorted = zeros(n);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      sorted[i][j] = vectors[i][order[j]];
    }
  }
  return { values, vectors: sorted };
}

/** Return the eigenvalues of a symmetric matrix, ascending (`numpy.linalg.eigvalsh`). */
export function eigenvaluesSymmetric(a) {
  return jacobiEigh(a).values;
}

/**
 * Symmetric square root `V diag(sqrt(w)) V^T` of a symmetric positive definite matrix.
 *
 * `scipy.linalg.sqrtm` in `magcal/ellipsoid.py` uses a Schur decomposition, but a positive
 * definite matrix has a unique principal root, so this eigen decomposition route returns the
 * same matrix to round-off (verified against scipy in `tools/compare_fit_routes.py`).
 */
export function sqrtmSymmetric(a) {
  const { values, vectors } = jacobiEigh(a);
  const n = a.length;
  for (let k = 0; k < n; k += 1) {
    if (!(values[k] >= 0)) {
      throw new LinAlgError("matrix has a negative eigenvalue, so it has no real square root");
    }
  }
  const roots = values.map((value) => Math.sqrt(value));
  const out = zeros(n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      let sum = 0;
      for (let k = 0; k < n; k += 1) {
        sum += vectors[i][k] * roots[k] * vectors[j][k];
      }
      out[i][j] = sum;
    }
  }
  return out;
}


