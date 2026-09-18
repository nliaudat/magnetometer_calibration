"""Build a single self-contained HTML file so the app works by double-clicking.

The app is normally ES modules served over HTTP (see docs/web-app.md), which a `file://` page
cannot load.  This builder writes

    site/magcal.html         the app, modules inlined as one classic script, sample embedded
    site/magcal-tests.html   the same core plus the parity suite, runnable offline

`magcal-tests.html` keeps the bundle honest: it runs the full parity suite from the file
system, so a bundling mistake cannot hide behind a working-looking page.

Bundling is deliberately simple - every module becomes an IIFE whose exports form a namespace
object, and `import {a, b} from "./m.js"` becomes `const {a, b} = __magcal_m;`.  Plain
concatenation would not work: `AXES`, for instance, is a top-level constant in three modules.

Run: ``python tools/build_single_file.py``  (``tools/build_site.py`` calls this for you)
"""

import argparse
import json
import os
import re

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(REPO_ROOT, "web")
SITE = os.path.join(REPO_ROOT, "site")
SAMPLE = os.path.join(REPO_ROOT, "mag_out_sample.txt")
FIXTURE = os.path.join(WEB, "tests", "golden", "python-golden.json")

# dependency order: `errors` first (everything may raise it), `plots` before the entry point
CORE = ["errors", "linalg", "format", "fit", "diagnostics", "loaders", "export", "plots"]
TEST_CORE = ["errors", "linalg", "format", "fit", "diagnostics", "loaders", "export"]
ENTRY = "app"
SPEC = "spec"

IMPORT_RE = re.compile(
    r'^import\s+\{([^}]*)\}\s+from\s+["\']\.{1,2}/([\w./-]+)\.js["\'];\s*$', re.MULTILINE)
EXPORT_RE = re.compile(r"^export\s+(function|class|const|let)\s+(\w+)", re.MULTILINE)
REEXPORT_RE = re.compile(r"^export\s*\{([^}]*)\};?\s*$", re.MULTILINE)
# Module syntax left in place would be a syntax error inside a classic script, so the builder
# refuses to write a page that still contains any (this is the bug class the bundler invites).
LEFTOVER_RE = re.compile(r"^\s*(?:import|export)\s", re.MULTILINE)
GUARD_RE = re.compile(r"<!-- file-guard:start -->.*?<!-- file-guard:end -->[^\n]*\n", re.DOTALL)
MODULE_SCRIPT_RE = re.compile(r'<script type="module" src="\./app\.js"></script>')
STYLESHEET_RE = re.compile(r'<link rel="stylesheet" href="\./style\.css">')


def read_web(*parts):
    """Return the text of a file below `web/`."""
    with open(os.path.join(WEB, *parts), "r", encoding="utf-8") as handle:
        return handle.read()


def exported_names(source):
    """Return the names a module exposes (`export function/const/class` and `export { ... }`)."""
    names = [match.group(2) for match in EXPORT_RE.finditer(source)]
    for match in REEXPORT_RE.finditer(source):
        for part in match.group(1).split(","):
            part = part.strip()
            if part:
                names.append(part.split(" as ")[-1].strip())
    return sorted(set(names))


def rewrite_imports(source):
    """Turn `import { a, b } from "./m.js";` into namespace destructuring statements."""
    statements = []
    for match in IMPORT_RE.finditer(source):
        names = ", ".join(part.strip() for part in match.group(1).split(",") if part.strip())
        module = match.group(2).rsplit("/", 1)[-1]     # "./js/fit.js" and "../js/fit.js" -> fit
        statements.append("const { %s } = __magcal_%s;" % (names, module))
    return "\n".join(statements + [IMPORT_RE.sub("", source)])


def strip_exports(source):
    """Remove the module syntax, keeping the declarations themselves."""
    source = EXPORT_RE.sub(lambda match: "%s %s" % (match.group(1), match.group(2)), source)
    return REEXPORT_RE.sub("", source)


def assert_bundled(label, source):
    """Fail the build when module syntax survives - it would break the whole classic script."""
    leftovers = LEFTOVER_RE.findall(source)
    if leftovers:
        raise SystemExit(
            "%s still contains %d line(s) of module syntax after bundling; extend "
            "IMPORT_RE/EXPORT_RE in tools/build_single_file.py" % (label, len(leftovers)))


def bundle(module_names):
    """Return JavaScript where each module is an IIFE exposing its own namespace object."""
    chunks = [
        "// Bundled from web/js.  Each module keeps its own scope, so top-level names that",
        "// repeat between modules (AXES, SEPARATOR, ...) cannot collide.",
        "",
    ]
    for name in module_names:
        source = read_web("js", name + ".js")
        body = strip_exports(rewrite_imports(source))
        assert_bundled("web/js/%s.js" % name, body)
        chunks.append("\n// --- web/js/%s.js %s" % (name, "-" * max(0, 52 - len(name))))
        chunks.append("const __magcal_%s = (function () {" % name)
        chunks.append(body)
        chunks.append("return { %s };" % ", ".join(exported_names(source)))
        chunks.append("})();")
    return "\n".join(chunks)


TESTS_SHELL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>magcal browser port - offline parity tests</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; }
  h1 { font-size: 1.3rem; }
  pre { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; padding: 1rem; overflow-x: auto; }
  code { background: #f6f8fa; padding: 0 .25rem; border-radius: 3px; }
</style>
</head>
<body>
<h1>magcal browser port - offline parity tests</h1>
<p>
  This page is self contained and needs no server. It runs the same checks as
  <code>web/tests/parity.html</code> - coefficients, diagnostics, capture parsing, number
  formatting and the exact C / JSON / ESPHome texts, all against
  <code>web/tests/golden/python-golden.json</code>, which the Python implementation produced.
  It is what verifies the single-file build of the app.
</p>
<pre id="results">running...</pre>
<script>
<!--SCRIPT-->
</script>
</body>
</html>
"""

RUNNER = r"""(function () {
  var results = runTests(window.__MAGCAL_FIXTURE__);
  var failures = results.filter(function (result) { return !result.ok; }).length;
  var lines = results.map(function (result) {
    return (result.ok ? "PASS  " : "FAIL  ") + result.name
      + (result.ok ? "" : "  <- " + result.detail);
  });
  lines.push("", (results.length - failures) + " passed, " + failures + " failed");
  document.getElementById("results").textContent = lines.join("\n");
  document.title = failures ? "FAIL (" + failures + ")" : "PASS (" + results.length + ")";
})();
"""


def safe_json(payload):
    """Return JSON that is safe to inline inside a `<script>` block."""
    return json.dumps(payload).replace("</", "<\\/")


def app_entry():
    """Return the app's own code (it has no exports and wires the DOM on load)."""
    source = strip_exports(rewrite_imports(read_web("app.js")))
    assert_bundled("web/app.js", source)
    return source


def spec_source():
    """Return the parity suite for the offline tests page."""
    with open(os.path.join(WEB, "tests", "spec.js"), "r", encoding="utf-8") as handle:
        source = strip_exports(rewrite_imports(handle.read()))
    assert_bundled("web/tests/spec.js", source)
    return source


def render_app(sample_text):
    """Return the single-file app: CSS, modules and the sample capture all inlined."""
    shell = read_web("index.html")
    shell = STYLESHEET_RE.sub(
        lambda match: "<style>\n%s\n</style>" % read_web("style.css"), shell, count=1)
    shell = GUARD_RE.sub("", shell, count=1)          # the single file does work from file://
    inline = ("<script>\n%s\n\n// --- web/app.js\n%s\n\nwindow.__MAGCAL_SAMPLE__ = %s;\n</script>"
              % (bundle(CORE), app_entry(), safe_json(sample_text)))
    shell = MODULE_SCRIPT_RE.sub(lambda match: inline, shell, count=1)
    if "__magcal_fit" not in shell or 'type="module"' in shell:
        raise SystemExit("bundle sanity check failed: the module script was not replaced")
    return shell


def render_tests():
    """Return the offline parity page: core + spec + fixture, all inline."""
    with open(FIXTURE, "r", encoding="utf-8") as handle:
        fixture = json.load(handle)
    script = "\n".join([
        bundle(TEST_CORE),
        "",
        "// --- web/tests/spec.js",
        spec_source(),
        "",
        "window.__MAGCAL_FIXTURE__ = %s;" % safe_json(fixture),
        "",
        RUNNER,
    ])
    return TESTS_SHELL.replace("<!--SCRIPT-->", script)


def build(site=SITE, verbose=True):
    """Write the two self-contained pages into `site/`; returns their paths."""
    os.makedirs(site, exist_ok=True)
    with open(SAMPLE, "r", encoding="utf-8") as handle:
        sample_text = handle.read()
    written = []
    for name, content in (("magcal.html", render_app(sample_text)),
                          ("magcal-tests.html", render_tests())):
        path = os.path.join(site, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)
        written.append(path)
        if verbose:
            print("  %-20s %6.0f kB" % (name, os.path.getsize(path) / 1024.0))
    return written


def main(argv=None):
    parser = argparse.ArgumentParser(description="build the self-contained offline pages")
    parser.add_argument("--site", default=SITE, help="output directory (default: site/)")
    options = parser.parse_args(argv)
    print("building the single-file pages:")
    build(options.site)
    print("double-click site/magcal.html - it needs no server")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
