/**
 * Input parsing - browser port of `magcal/loaders.py`.
 *
 * Accepts what the CLI accepts: comma / semicolon / tab / whitespace separated rows, an
 * optional header that names the axes (and the unit, e.g. `mag_x_uT`), raw ESPHome/serial
 * log lines, and an explicit extract-pattern regex.  The parse report keeps the CLI's
 * snake_case keys so the `--report json` `input` section can be reproduced exactly.
 */

import { ValueError } from "./errors.js";

export const MICROTESLA_PER_GAUSS = 100.0;
export const NANOTESLA_PER_MICROTESLA = 1000.0;
export const MICROTESLA_PER_TESLA = 1.0e6;

/** Header used for a written calibrated CSV (mirrors `magcal.constants`). */
export const DEFAULT_CALIBRATED_HEADER = ["mag_x_ut", "mag_y_ut", "mag_z_ut"];

export const UNIT_TO_MICROTESLA = {
  gauss: MICROTESLA_PER_GAUSS,
  microtesla: 1.0,
  nanotesla: 1.0 / NANOTESLA_PER_MICROTESLA,
  tesla: MICROTESLA_PER_TESLA,
};

export const UNIT_SUFFIXES = {
  g: "gauss", ga: "gauss", gs: "gauss", gauss: "gauss",
  ut: "microtesla", microtesla: "microtesla",
  nt: "nanotesla", nanotesla: "nanotesla",
  t: "tesla", tesla: "tesla",
};

export const AXIS_ALIASES = { x: 0, xm: 0, y: 1, ym: 1, z: 2, zm: 2 };

const FLOAT_SOURCE = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";

/**
 * Matches the last three numbers of a line, separated by `,`, `;` or TAB.
 *
 * Used to read raw ESPHome/serial logs such as `[12:34:56][D][main:090]: 33.1,98.3,571.2`.
 */
export const DEFAULT_EXTRACT_PATTERN
  = `(${FLOAT_SOURCE})\\s*[,;\\t]\\s*(${FLOAT_SOURCE})\\s*[,;\\t]\\s*(${FLOAT_SOURCE})\\s*$`;

/** Return an empty parse report (the CLI's snake_case keys, `magcal.model.ParseReport`). */
export function createReport() {
  return {
    rows_total: 0,
    rows_used: 0,
    rows_skipped: 0,
    delimiter: null,
    header: null,
    header_used: false,
    unit: null,
    unit_source: "undetected",
    log_format: false,
    source: null,
    input_unit: null,
  };
}

/** Parse a numeric token, returning null when it is not a finite number (`_to_float`). */
export function toFloat(token) {
  if (typeof token !== "string" || token.trim() === "") {
    return null;
  }
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

/** Split a column name into lowercase alphanumeric tokens (`mag_x_uT` -> mag, x, ut). */
export function columnTokens(name) {
  return String(name).toLowerCase().replace(/\u00b5/g, "u")
    .split(/[^0-9a-z]+/)
    .filter((token) => token.length > 0);
}

/** Infer the unit from a column name suffix, or null when undetectable. */
export function unitFromColumn(name) {
  const tokens = columnTokens(name);
  if (tokens.length === 0) {
    return null;
  }
  return UNIT_SUFFIXES[tokens[tokens.length - 1]] || null;
}

/** Return the axis index (0=x, 1=y, 2=z) named by a column, or null. */
export function axisFromColumn(name) {
  for (const token of columnTokens(name)) {
    if (Object.prototype.hasOwnProperty.call(AXIS_ALIASES, token)) {
      return AXIS_ALIASES[token];
    }
  }
  return null;
}

/** Map X/Y/Z onto column positions using header names; returns `[mapping, unit]`. */
export function mapColumns(headerCells) {
  const mapping = {};
  const units = new Set();
  headerCells.forEach((cell, index) => {
    const axis = axisFromColumn(cell);
    if (axis === null || Object.prototype.hasOwnProperty.call(mapping, axis)) {
      return;
    }
    mapping[axis] = index;
    const unit = unitFromColumn(cell);
    if (unit !== null) {
      units.add(unit);
    }
  });
  if (mapping[0] !== undefined && mapping[1] !== undefined && mapping[2] !== undefined
    && units.size === 1) {
    return [mapping, [...units][0]];
  }
  const complete = mapping[0] !== undefined && mapping[1] !== undefined && mapping[2] !== undefined;
  return [complete ? mapping : {}, null];
}

/** True for a comment line (`#`, `//` or `;`). */
export function isComment(line) {
  const stripped = line.replace(/^\s+/, "");
  return stripped.startsWith("#") || stripped.startsWith("//") || stripped.startsWith(";");
}

/** Count the capturing groups of a regular expression source (Python's `re.groups`). */
export function countCaptureGroups(source) {
  let count = 0;
  let escaped = false;
  let inClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (inClass) {
      inClass = character !== "]";
    } else if (character === "[") {
      inClass = true;
    } else if (character === "(") {
      const ahead = source.slice(index + 1, index + 4);
      const named = ahead.startsWith("?<") && !ahead.startsWith("?<=") && !ahead.startsWith("?<!");
      if (source[index + 1] !== "?" || named) {
        count += 1;
      }
    }
  }
  return count;
}

/** Split one record with the detected delimiter, honouring double quotes (`csv.reader`). */
export function splitFields(line, delimiter) {
  if (delimiter === null || delimiter === undefined) {
    return line.trim().split(/\s+/).filter((field) => field.length > 0);
  }
  const fields = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"' && current.trim() === "") {
      quoted = true;
      current = "";
    } else if (character === delimiter) {
      fields.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Pick the first candidate delimiter that yields three or more fields per line. */
export function sniffDelimiter(lines) {
  const candidates = [",", ";", "\t", null];
  const counts = new Map(candidates.map((candidate) => [candidate, 0]));
  lines.slice(0, 50).forEach((line) => {
    if (line.trim() === "" || isComment(line)) {
      return;
    }
    candidates.forEach((candidate) => {
      if (splitFields(line, candidate).length >= 3) {
        counts.set(candidate, counts.get(candidate) + 1);
      }
    });
  });
  for (const candidate of candidates) {
    if (counts.get(candidate) > 0) {
      return candidate;
    }
  }
  return null;
}

/** Convert one split record into `[x, y, z]`, or null when it is unusable. */
export function rowToSample(fields, headerMap) {
  let values;
  const mapped = headerMap && Object.keys(headerMap).length === 3;
  if (mapped) {
    const indexes = [headerMap[0], headerMap[1], headerMap[2]];
    if (Math.max(...indexes) >= fields.length) {
      return null;
    }
    values = indexes.map((index) => fields[index]);
  } else {
    if (fields.length < 3) {
      return null;
    }
    values = fields.slice(-3);
  }
  const parsed = values.map(toFloat);
  return parsed.some((value) => value === null) ? null : parsed;
}

/** Extract one sample per line with a regex exposing three groups (`--extract-pattern`). */
export function parseWithPattern(lines, pattern, report) {
  if (countCaptureGroups(pattern) < 3) {
    throw new ValueError("--extract-pattern must expose at least 3 capture groups (x, y, z)");
  }
  let regex;
  try {
    regex = new RegExp(pattern);
  } catch (error) {
    throw new ValueError(`invalid --extract-pattern regular expression: ${error.message}`);
  }
  const rows = [];
  lines.forEach((line) => {
    if (line.trim() === "" || isComment(line)) {
      return;
    }
    report.rows_total += 1;
    const match = regex.exec(line);
    const values = match ? [match[1], match[2], match[3]].map(toFloat) : [];
    if (match === null || values.some((value) => value === null)) {
      report.rows_skipped += 1;
      return;
    }
    rows.push(values);
  });
  report.rows_used = rows.length;
  return rows;
}

/**
 * Parse the delimiter separated records of a capture.
 *
 * Returns `[samples, wideRows]`, where `wideRows` counts rows with more than four columns and
 * no header naming the axes - usually a file that needs a header.
 */
export function readDelimitedSamples(lines, report) {
  const delimiter = sniffDelimiter(lines);
  report.delimiter = delimiter === null ? "whitespace" : delimiter;
  let headerMap = {};
  const rows = [];
  let wideRows = 0;
  lines.forEach((line) => {
    if (line.trim() === "" || isComment(line)) {
      return;
    }
    report.rows_total += 1;
    const fields = splitFields(line, delimiter);
    if (Object.keys(headerMap).length === 0 && !report.header_used
      && fields.some((field) => toFloat(field) === null)) {
      report.header_used = true;
      report.header = fields;
      const [mapping, unit] = mapColumns(fields);
      if (unit !== null) {
        report.unit = unit;
        report.unit_source = "header";
      }
      if (Object.keys(mapping).length === 3) {
        headerMap = mapping;
      }
      report.rows_skipped += 1;
      return;
    }
    if (fields.length > 4 && Object.keys(headerMap).length === 0) {
      wideRows += 1;
      report.rows_skipped += 1;
      return;
    }
    const sample = rowToSample(fields, headerMap);
    if (sample === null) {
      report.rows_skipped += 1;
      return;
    }
    rows.push(sample);
  });
  report.rows_used = rows.length;
  return [rows, wideRows];
}

/** Retry a capture as raw ESPHome/serial log lines; returns null when nothing matched. */
export function extractLogSamples(lines, report) {
  const logReport = createReport();
  const samples = parseWithPattern(lines, DEFAULT_EXTRACT_PATTERN, logReport);
  if (samples.length === 0) {
    return null;
  }
  report.rows_total = logReport.rows_total;
  report.rows_used = logReport.rows_used;
  report.rows_skipped = logReport.rows_skipped;
  report.delimiter = "regex";
  report.log_format = true;
  return samples;
}

/**
 * Parse magnetometer samples from text; returns `[samples, report]` (`_parse_samples`).
 *
 * Raises `ValueError` with the CLI's wording when nothing usable is found.
 */
export function parseSamples(text, extractPattern = null, source = null) {  const lines = text.split(/\r\n|\r|\n/);
  const report = createReport();
  report.source = source;
  if (extractPattern) {
    const samples = parseWithPattern(lines, extractPattern, report);
    report.delimiter = "regex";
    report.log_format = true;
    if (samples.length === 0) {
      throw new ValueError("no samples matched --extract-pattern; check the regular expression");
    }
    return [samples, report];
  }
  const [samples, wideRows] = readDelimitedSamples(lines, report);
  if (samples.length === 0 && wideRows > 0) {
    throw new ValueError(
      "no samples parsed: the file has more than 4 columns and no header naming x/y/z; "
      + "add a header (e.g. 'time,mag_x,mag_y,mag_z') or select the columns first",
    );
  }
  if (samples.length === 0) {
    const logSamples = extractLogSamples(lines, report);
    if (logSamples !== null) {
      return [logSamples, report];
    }
    throw new ValueError(
      "no magnetometer samples found in the input; expected numeric x,y,z rows "
      + "(use --extract-pattern for log files with extra text)",
    );
  }
  return [samples, report];
}

/** Euclidean distance between two samples. */
function distance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

/** Deterministic 32 bit PRNG (mulberry32): the documented stand-in for numpy's PCG64. */
export function createRandom(seed) {
  let state = (Number(seed) || 0) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick `count` distinct indices below `size` (partial Fisher-Yates). */
function pickIndices(size, count, seed) {
  const random = createRandom(seed);
  const pool = [];
  for (let index = 0; index < size; index += 1) {
    pool.push(index);
  }
  for (let index = 0; index < count; index += 1) {
    const swap = index + Math.floor(random() * (size - index));
    const temporary = pool[index];
    pool[index] = pool[swap];
    pool[swap] = temporary;
  }
  return pool.slice(0, count);
}

/**
 * Drop parked/duplicate samples (`--min-delta`) and optionally subsample (`--max-points`).
 *
 * Returns `[filtered, report]` with the CLI's snake_case filter report.  The subsample uses a
 * seeded JavaScript PRNG rather than numpy's PCG64, so `--max-points` keeps a different - but
 * equally valid and reproducible - subset than the CLI (see docs/web-app.md).
 */
export function filterSamples(samples, minDelta = 0.0, maxPoints = null, seed = 0) {
  const delta = Number(minDelta) || 0;
  const kept = [];
  let last = null;
  samples.forEach((sample, index) => {
    if (index === 0 || distance(sample, last) >= delta) {
      kept.push(index);
      last = sample;
    }
  });
  let filtered = kept.map((index) => samples[index]);
  const report = {
    input: samples.length,
    after_min_delta: filtered.length,
    min_delta: delta,
    max_points: maxPoints ? Number(maxPoints) : null,
    subsampled: false,
    kept: filtered.length,
  };
  if (maxPoints && filtered.length > Number(maxPoints)) {
    const picked = pickIndices(filtered.length, Number(maxPoints), seed);
    picked.sort((left, right) => left - right);
    filtered = picked.map((index) => filtered[index]);
    report.subsampled = true;
    report.kept = filtered.length;
  }
  return [filtered, report];
}

/**
 * Return the calibrated samples as CSV text with six decimals.
 *
 * Mirrors `magcal.loaders.write_calibrated_data`, including the CRLF line endings that
 * Python's `csv.writer` produces.
 */
export function writeCalibratedCsv(samples, header = DEFAULT_CALIBRATED_HEADER) {
  const lines = [];
  if (header && header.length) {
    lines.push(header.join(","));
  }
  samples.forEach((sample) => {
    lines.push(sample.map((value) => value.toFixed(6)).join(","));
  });
  return `${lines.join("\r\n")}\r\n`;
}
