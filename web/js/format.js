/**
 * C `printf` compatible number formatting.
 *
 * `magcal` prints coefficients with `%.6f` (the C block) and `%.12g` (the ESPHome lambda), so
 * the port has to reproduce those exactly.  The pinned expectations in
 * `web/tests/golden/python-golden.json` are produced by Python's own `%` operator, which is
 * correctly rounded and rounds *half to even*; JavaScript's `toFixed` rounds ties away from
 * zero, which is why `formatSix` handles exact decimal ties itself.
 */

/** True when `magnitude` is an exact decimal tie at the seventh digit (e.g. 0.0078125). */
function isSeventhDigitTie(magnitude) {
  if (!(magnitude < 1e7)) {
    return false;
  }
  // `toFixed(20)` exposes the exact decimal digits, so a real tie shows up as six decimals
  // followed by a 5 and nothing else.  Multiplying by 1e7 instead would *create* ties: the
  // product of 2.0000005 by 1e6 rounds to exactly 2000000.5.
  return /^\d+\.\d{6}5(0*)$/.test(magnitude.toFixed(20));
}

/** Return `value` formatted like C's `%.6f` (six decimals, half to even on exact ties). */
export function formatSix(value) {
  const number = Number(value);
  if (Number.isNaN(number)) {
    return "nan";
  }
  if (!Number.isFinite(number)) {
    return number > 0 ? "inf" : "-inf";
  }
  const negative = number < 0 || Object.is(number, -0);
  const magnitude = Math.abs(number);
  let digits;
  if (magnitude >= 1e21) {
    // toFixed switches to exponential notation up there; such doubles are integers, so the
    // integer part can be produced exactly (and the fraction is always .000000)
    digits = `${BigInt(magnitude)}000000`;
  } else if (isSeventhDigitTie(magnitude)) {
    const lower = Math.floor((magnitude * 1e7) / 10);
    digits = String(lower % 2 === 0 ? lower : lower + 1);
  } else {
    digits = magnitude.toFixed(6).replace(".", "");
  }
  digits = digits.padStart(7, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -6)}.${digits.slice(-6)}`;
}

/**
 * Return `value` formatted like C's `%.<precision>g`.
 *
 * `%g` rounds to `precision` significant digits, then picks the exponent form when the
 * decimal exponent is below -4 or at least `precision`, and finally removes trailing zeros
 * from the *fraction* only - which is why `99999999999.9999` prints as `100000000000`
 * rather than `1e+11`.
 */
export function formatGauss(value, precision = 12) {
  const number = Number(value);
  if (Number.isNaN(number)) {
    return "nan";
  }
  if (!Number.isFinite(number)) {
    return number > 0 ? "inf" : "-inf";
  }
  const negative = number < 0 || Object.is(number, -0);
  const magnitude = Math.abs(number);
  if (magnitude === 0) {
    return negative ? "-0" : "0";
  }
  const exponential = magnitude.toExponential(Math.max(0, precision - 1));
  const [mantissa, exponentText] = exponential.split("e");
  const exponent = Number(exponentText);
  let digits = mantissa.replace(".", "").replace(/0+$/, "");
  if (digits === "") {
    digits = "0";
  }
  const sign = negative ? "-" : "";
  if (exponent < -4 || exponent >= precision) {
    const head = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const exponentSign = exponent < 0 ? "-" : "+";
    const exponentDigits = String(Math.abs(exponent)).padStart(2, "0");
    return `${sign}${head}e${exponentSign}${exponentDigits}`;
  }
  if (exponent >= 0) {
    const integerDigits = digits.slice(0, exponent + 1).padEnd(exponent + 1, "0");
    const fraction = digits.slice(exponent + 1);
    return `${sign}${integerDigits}${fraction ? `.${fraction}` : ""}`;
  }
  const leadingZeros = "0".repeat(-exponent - 1);
  return `${sign}0.${leadingZeros}${digits}`;
}
