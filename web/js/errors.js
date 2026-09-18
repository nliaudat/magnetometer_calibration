/**
 * Domain errors shared by the browser modules.
 *
 * `magcal` raises `ValueError` with an actionable message for every unusable capture; the
 * port raises the same class with the same wording so the app can show exactly what the CLI
 * would print.
 */

/** Raised for the same reasons `magcal` raises `ValueError`. */
export class ValueError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValueError";
  }
}

/** Raised when a decomposition fails (singular matrix, not positive definite). */
export class LinAlgError extends Error {
  constructor(message) {
    super(message);
    this.name = "LinAlgError";
  }
}
