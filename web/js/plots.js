/**
 * Dependency-free SVG plots: the before/after projections and the `|B|` histogram.
 *
 * The CLI draws these with matplotlib; a static page cannot, so the port renders plain SVG
 * instead (same information, no rendering library).  The histogram is the visual equivalent
 * of the residual report: a correct calibration collapses every sample onto the target field.
 */

const SIZE = 260;
const PAD = 30;

/** Map a data value into an SVG coordinate. */
function scale(value, low, high, direction) {
  const span = high - low || 1;
  const fraction = (value - low) / span;
  return direction === "x" ? PAD + fraction * (SIZE - 2 * PAD) : SIZE - PAD - fraction * (SIZE - 2 * PAD);
}

/** Return a `<polyline>`/`<circle>` list for one sample set. */
function points(samples, first, second, limits, colour, radius) {
  return samples.map((sample) => {
    const cx = scale(sample[first], limits.low, limits.high, "x");
    const cy = scale(sample[second], limits.low, limits.high, "y");
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius}" fill="${colour}" />`;
  }).join("");
}

/** One projection panel: raw samples in grey behind the calibrated ones in red. */
function projectionSvg(samples, calibrated, first, second, label) {
  const values = samples.concat(calibrated).flatMap((sample) => [sample[first], sample[second]]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const limits = { low, high };
  return `<svg class="plot" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img">
  <rect x="${PAD}" y="${PAD}" width="${SIZE - 2 * PAD}" height="${SIZE - 2 * PAD}" fill="none" stroke="#d1d9e0" />
  ${points(samples, first, second, limits, "#c8ccd1", 1.6)}
  ${points(calibrated, first, second, limits, "#cf222e", 1.6)}
  <text x="${SIZE / 2}" y="${SIZE - 8}" text-anchor="middle" font-size="11">${"xyz"[first]} (uT)</text>
  <text x="10" y="${SIZE / 2}" font-size="11" transform="rotate(-90 10 ${SIZE / 2})"
    text-anchor="middle">${"xyz"[second]} (uT)</text>
  <text x="${PAD}" y="18" font-size="12">${label}</text>
</svg>`;
}

/** Histogram of `|B|` before and after the calibration, with the target line. */
function histogramSvg(samples, calibrated, fieldStrength) {
  const magnitudes = (set) => set.map((sample) => Math.hypot(sample[0], sample[1], sample[2]));
  const raw = magnitudes(samples);
  const fixed = magnitudes(calibrated);
  const all = raw.concat(fixed);
  const low = Math.min(...all);
  const high = Math.max(...all);
  const bins = 30;
  const width = (high - low) / bins || 1;
  const counts = (values) => {
    const result = new Array(bins).fill(0);
    values.forEach((value) => {
      const index = Math.min(bins - 1, Math.max(0, Math.floor((value - low) / width)));
      result[index] += 1;
    });
    return result;
  };
  const rawCounts = counts(raw);
  const fixedCounts = counts(fixed);
  const peak = Math.max(...rawCounts, ...fixedCounts, 1);
  const bar = (SIZE - 2 * PAD) / bins;
  const bars = (values, colour, offset) => values.map((count, index) => {
    const height = (count / peak) * (SIZE - 2 * PAD);
    const x = PAD + index * bar + offset;
    return `<rect x="${x.toFixed(1)}" y="${(SIZE - PAD - height).toFixed(1)}" width="${(bar / 2).toFixed(1)}"`
      + ` height="${height.toFixed(1)}" fill="${colour}" />`;
  }).join("");
  const targetX = scale(fieldStrength, low, high, "x");
  return `<svg class="plot" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img">
  <rect x="${PAD}" y="${PAD}" width="${SIZE - 2 * PAD}" height="${SIZE - 2 * PAD}" fill="none" stroke="#d1d9e0" />
  ${bars(rawCounts, "#c8ccd1", 0)}
  ${bars(fixedCounts, "#cf222e", bar / 2)}
  <line x1="${targetX.toFixed(1)}" y1="${PAD}" x2="${targetX.toFixed(1)}" y2="${SIZE - PAD}"
    stroke="#1f2328" stroke-dasharray="4 3" />
  <text x="${SIZE / 2}" y="${SIZE - 8}" text-anchor="middle" font-size="11">|B| (uT)</text>
  <text x="${PAD}" y="18" font-size="12">|B| before (grey) / after (red), target dashed</text>
</svg>`;
}

/** Render every panel into `container` (replacing what was there). */
export function renderPlots(container, { samples, calibrated, fieldStrength }) {
  container.innerHTML = [
    "<h3>Projections</h3>",
    '<div class="row">',
    [[0, 1, "XY plane"], [0, 2, "XZ plane"], [1, 2, "YZ plane"]]
      .map(([first, second, label]) => projectionSvg(samples, calibrated, first, second, label))
      .join(""),
    "</div>",
    "<h3>Field magnitude</h3>",
    '<div class="row">',
    histogramSvg(samples, calibrated, fieldStrength),
    "</div>",
  ].join("\n");
}
