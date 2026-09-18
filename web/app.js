/**
 * The web app: capture -> parse -> fit -> quality report -> exports.
 *
 * Everything runs locally; the only network request is the optional sample capture.  The
 * numeric work lives in `./js/linalg.js`, `fit.js`, `diagnostics.js`, `loaders.js`,
 * `format.js` and `export.js`, which `web/tests/parity.html` (and `tools/run_web_tests.py`)
 * check against the Python implementation.
 */

import { applyCalibrationAll, buildCalibration } from "./js/fit.js";
import { evaluate, formatDiagnostics } from "./js/diagnostics.js";
import {
  UNIT_TO_MICROTESLA, filterSamples, parseSamples, writeCalibratedCsv,
} from "./js/loaders.js";
import { patchEsphomeYaml, renderCCode, renderEsphomeLambda, renderJsonBlock } from "./js/export.js";
import { renderPlots } from "./js/plots.js";

/** The sample capture: as built for the site, then as checked out in the repository. */
const SAMPLE_PATHS = ["./samples/mag_out_sample.txt", "../mag_out_sample.txt"];

/**
 * The bundled capture was recorded at about 515 microTesla - the value the README, the tests and
 * the committed golden report use (see docs/gravitation-field.md).
 *
 * `A_1 = F/sqrt(k) * sqrtm(M)` is proportional to the expected field, and the `|B|` residual is
 * field *invariant*, so a wrong value here cannot be detected from the quality report: it only
 * makes every soft-iron entry wrong by the same factor.  Filling it in with the sample removes
 * that trap for the one capture we ship.
 */
const SAMPLE_FIELD = 515;
const AXES = ["x", "y", "z"];

const ui = {};
`capture-text input-report field unit min-delta max-points extract-pattern declination max-error
 calibrate-button sample-button clear-button status file-input dropzone result-panel error-panel
 error-text quality-badge field-note warnings hard-iron-table soft-iron-table plots report-text
 report-json c-code esphome-lambda download-csv download-json copy-c copy-esphome esphome-file
 esphome-report`.split(/\s+/).forEach((id) => { ui[id] = document.getElementById(id); });

let state = null;       // { samples, calibration, calibrated, diagnostics, report }

function setStatus(text) {
  ui.status.textContent = text;
}

function showError(message) {
  ui["error-text"].textContent = message;
  ui["error-panel"].hidden = false;
  ui["result-panel"].hidden = true;
}

function clearError() {
  ui["error-panel"].hidden = true;
  ui["error-text"].textContent = "";
}

function download(name, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = original; }, 1200);
  } catch (error) {
    setStatus(`copy failed: ${error.message}`);
  }
}

function numberValue(id, fallback) {
  const raw = ui[id].value.trim();
  if (raw === "") {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Parse the capture textarea and convert it to microTesla.
 *
 * Mirrors `MagnetometerCalibrator.load_data`: `auto` uses the unit found in the column names
 * and falls back to microTesla, and an explicit unit overrides the header.
 */
function readCapture() {
  const text = ui["capture-text"].value;
  if (text.trim() === "") {
    ui["input-report"].textContent = "no capture loaded yet";
    return null;
  }
  const pattern = ui["extract-pattern"].value.trim() || null;
  const [samples, report] = parseSamples(text, pattern, "pasted capture");
  const requested = ui.unit.value;
  const detected = report.unit;
  const effective = requested === "auto" ? (detected || "microtesla") : requested;
  report.unit_source = requested === "auto" ? (detected ? "header" : "default") : "argument";
  report.input_unit = effective;
  const factor = UNIT_TO_MICROTESLA[effective];
  const converted = samples.map((sample) => sample.map((value) => value * factor));
  const notes = [`${report.rows_used} of ${report.rows_total} rows used`,
    `separator ${report.delimiter === " " ? "space" : JSON.stringify(report.delimiter)}`,
    `unit ${effective}`];
  if (report.header_used) {
    notes.push(`header ${JSON.stringify(report.header)}`);
  }
  if (report.log_format) {
    notes.push("raw log format");
  }
  if (requested !== "auto" && detected && detected !== requested) {
    notes.push(`note: the header says ${detected}, using ${effective}`);
  }
  ui["input-report"].textContent = notes.join(" | ");
  return { samples: converted, report };
}

function renderTable(element, headers, rows) {
  const head = `<tr>${headers.map((cell) => `<th>${cell}</th>`).join("")}</tr>`;
  const body = rows.map(
    (row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`,
  ).join("");
  element.innerHTML = head + body;
}

function run() {
  clearError();
  let capture = null;
  try {
    capture = readCapture();
  } catch (error) {
    showError(error && error.message ? error.message : String(error));
    return;
  }
  if (capture === null) {
    showError("Load or paste a capture first.");
    return;
  }
  const field = numberValue("field", 1000);
  const maxError = numberValue("max-error", 5);
  const minDelta = numberValue("min-delta", 0);
  const maxPoints = ui["max-points"].value.trim() === "" ? null : numberValue("max-points", null);
  let samples = capture.samples;
  let filterReport = null;
  if (minDelta > 0 || maxPoints) {
    [samples, filterReport] = filterSamples(samples, minDelta, maxPoints, 0);
  }
  try {
    setStatus("calibrating...");
    const started = performance.now();
    const calibration = buildCalibration(samples, field);
    const calibrated = applyCalibrationAll(calibration, samples);
    const diagnostics = evaluate(samples, calibrated, field, maxError);
    const elapsed = performance.now() - started;
    state = { samples, calibration, calibrated, diagnostics, report: capture.report, filterReport };
    renderResult(elapsed);
    setStatus(`${samples.length} samples fitted in ${elapsed.toFixed(1)} ms`);
  } catch (error) {
    setStatus("failed");
    state = null;
    showError(error && error.message ? error.message : String(error));
  }
}

/** Build the JSON record (schema v2) that the CLI writes with `--json`. */
function buildJsonRecord() {
  const { calibration, diagnostics, report, samples, filterReport } = state;
  const stats = (measured) => ({
    mean: measured.mean,
    std: measured.std,
    min: measured.min,
    max: measured.max,
    rms_error: measured.rmsError,
    percent_error: measured.percentError,
  });
  return {
    version: 2,
    created: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    mode: "calibrate",
    source_file: report.source,
    num_points: samples.length,
    magnetic_field_strength: calibration.fieldStrength,
    unit: "microtesla",
    hard_iron_bias: calibration.hardIron,
    soft_iron_matrix: calibration.softIron,
    diagnostics: {
      target_field_strength: diagnostics.targetFieldStrength,
      raw: stats(diagnostics.raw),
      axis_spans_raw: diagnostics.axisSpansRaw,
      coverage_ratio: diagnostics.coverageRatio,
      covariance_eigenvalues: diagnostics.covarianceEigenvalues,
      condition_number: diagnostics.conditionNumber,
      max_error_percent: diagnostics.maxErrorPercent,
      warnings: diagnostics.warnings,
      calibrated: stats(diagnostics.calibrated),
      percent_error: diagnostics.percentError,
      passed: diagnostics.passed,
    },
    quality: {
      passed: diagnostics.passed,
      percent_error: diagnostics.percentError,
      max_error_percent: diagnostics.maxErrorPercent,
    },
    input: report,
    filter: filterReport,
  };
}

/** Show everything the fit produced. */
function renderResult(elapsed) {
  const { calibration, calibrated, diagnostics, samples } = state;
  ui["result-panel"].hidden = false;

  ui["quality-badge"].textContent = `${diagnostics.passed ? "PASS" : "FAIL"} - residual |B| `
    + `error ${diagnostics.percentError.toFixed(2)}% (target ${diagnostics.maxErrorPercent}%)`;
  ui["quality-badge"].className = `badge ${diagnostics.passed ? "pass" : "fail"}`;
  ui["field-note"].textContent = `expected field ${calibration.fieldStrength} microTesla - the `
    + "soft-iron matrix scales linearly with it (double the field, double every entry), and the "
    + "residual cannot detect a wrong value: check docs/gravitation-field.md for your location.";
  ui.warnings.innerHTML = diagnostics.warnings
    .map((warning) => `<p>warning: ${warning}</p>`).join("");

  renderTable(ui["hard-iron-table"], ["axis", "microTesla"],
    AXES.map((axis, index) => [axis.toUpperCase(), calibration.hardIron[index].toFixed(6)]));
  renderTable(ui["soft-iron-table"], AXES.map((axis) => axis.toUpperCase()),
    calibration.softIron.map((row) => row.map((value) => value.toFixed(6))));

  try {
    renderPlots(ui.plots, { samples, calibrated, fieldStrength: calibration.fieldStrength });
  } catch (error) {
    ui.plots.textContent = `plots unavailable: ${error.message}`;
  }

  state.text = {
    diagnostics: formatDiagnostics(diagnostics),
    cCode: renderCCode(calibration),
    lambda: renderEsphomeLambda(calibration, { declination: numberValue("declination", 0) }),
    jsonBlock: renderJsonBlock(calibration),
    record: JSON.stringify(buildJsonRecord(), null, 4),
  };
  ui["report-text"].textContent = state.text.diagnostics;
  ui["report-json"].textContent = state.text.record;
  ui["c-code"].textContent = state.text.cCode;
  ui["esphome-lambda"].textContent = state.text.lambda;
  setStatus(`${samples.length} samples fitted in ${elapsed.toFixed(1)} ms`);
}

async function loadSample() {
  // The single-file build (tools/build_single_file.py) embeds the capture, so the app also
  // works from a file:// page where fetch() is unavailable.
  const embedded = typeof window !== "undefined" ? window.__MAGCAL_SAMPLE__ : null;
  if (embedded) {
    applySample(embedded, "the embedded sample capture");
    return;
  }
  for (const path of SAMPLE_PATHS) {
    try {
      const response = await fetch(path);
      if (response.ok) {
        applySample(await response.text(), path);
        return;
      }
    } catch (error) {
      // try the next location
    }
  }
  setStatus("could not load the sample capture - paste your own capture, or open this page "
    + "through `python tools/serve.py` (see the note at the top of the page)");
}

/** Load a capture into the textarea and align the expected field with it. */
function applySample(text, source) {
  ui["capture-text"].value = text;
  ui.field.value = String(SAMPLE_FIELD);
  clearError();
  setStatus(`loaded ${source} - expected field set to ${SAMPLE_FIELD} microTesla`);
}

function readInto(file, target) {
  const reader = new FileReader();
  reader.onload = () => {
    ui[target].value = String(reader.result);
    clearError();
    setStatus(`loaded ${file.name} (${file.size} bytes)`);
  };
  reader.readAsText(file);
}

function wireDropzone() {
  const zone = ui.dropzone;
  ["dragenter", "dragover"].forEach((type) => zone.addEventListener(type, (event) => {
    event.preventDefault();
    zone.classList.add("over");
  }));
  ["dragleave", "drop"].forEach((type) => zone.addEventListener(type, () => {
    zone.classList.remove("over");
  }));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer && event.dataTransfer.files[0];
    if (file) {
      readInto(file, "capture-text");
    }
  });
  ui["file-input"].addEventListener("change", (event) => {
    if (event.target.files[0]) {
      readInto(event.target.files[0], "capture-text");
    }
  });
}

function wireEvents() {
  wireDropzone();
  ui["calibrate-button"].addEventListener("click", run);
  ui["sample-button"].addEventListener("click", loadSample);
  ui["clear-button"].addEventListener("click", () => {
    ui["capture-text"].value = "";
    ui["input-report"].textContent = "no capture loaded yet";
    ui["result-panel"].hidden = true;
    state = null;
    clearError();
    setStatus("ready");
  });
  ui["download-csv"].addEventListener("click", () => {
    if (state) {
      download("calibrated.csv", writeCalibratedCsv(state.calibrated));
    }
  });
  ui["download-json"].addEventListener("click", () => {
    if (state) {
      download("calibration.json", state.text.record, "application/json");
    }
  });
  ui["copy-c"].addEventListener("click", (event) => {
    if (state) {
      copyText(state.text.cCode, event.currentTarget);
    }
  });
  ui["copy-esphome"].addEventListener("click", (event) => {
    if (state) {
      copyText(state.text.lambda, event.currentTarget);
    }
  });
  ui["esphome-file"].addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file || !state) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = patchEsphomeYaml(String(reader.result), state.calibration);
        download(`${file.name.replace(/\.ya?ml$/, "")}_calibrated.yaml`, result.text, "text/yaml");
        ui["esphome-report"].textContent
          = `replaced ${result.replacements} constants in ${file.name}`;
      } catch (error) {
        ui["esphome-report"].textContent = error.message;
      }
    };
    reader.readAsText(file);
  });
}

wireEvents();
setStatus("ready");
document.body.dataset.app = "ready";
