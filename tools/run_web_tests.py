"""Run the browser parity tests without Node: serve the repo, drive headless Chrome.

Node is not always installed (it is not on the machine this port was written on), and a
browser is the *real* target environment, so the same checks that run in CI with
``node --test`` also run as an HTML page::

    python tools/run_web_tests.py                 # chrome, then edge, then error out
    python tools/run_web_tests.py --browser msedge --port 8791 --headless=new

The page renders one PASS/FAIL line per check into ``<pre id="results">``; this script
extracts that block with ``--dump-dom`` and mirrors the exit code.
"""

import argparse
import functools
import html
import http.server
import os
import re
import shutil
import subprocess
import sys
import threading
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "/web/tests/parity.html"
RESULTS_RE = re.compile(r'<pre id="results">(.*?)</pre>', re.DOTALL)
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.DOTALL)

CANDIDATES = {
    "chrome": [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ],
    "msedge": [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ],
    "chromium": ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"],
}


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Serve the repository root and keep the terminal readable."""

    def log_message(self, *args):        # pragma: no cover - noise suppression only
        pass


def start_server(port):
    """Serve the repo root in a background thread; returns (server, thread)."""
    handler = functools.partial(_QuietHandler, directory=REPO_ROOT)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def find_browser(name):
    """Return the executable for `name`, or None."""
    for candidate in CANDIDATES.get(name, []):
        located = shutil.which(candidate) or (candidate if os.path.isfile(candidate) else None)
        if located:
            return located
    return None


def run_browser(executable, url, timeout):
    """Load the page headless and return its DOM."""
    command = [
        executable, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--disable-extensions", "--virtual-time-budget=60000", "--dump-dom", url,
    ]
    completed = subprocess.run(command, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=timeout)
    return completed.stdout + completed.stderr


def load_page(executable, url, timeout, attempts, settle):
    """Poll the page until its title reports a result; return (title, text, dom).

    The dump can happen before the module script and its `fetch` have finished, and whether
    it does is version dependent, so the title doubles as a "the tests are done" flag.
    """
    dom = ""
    for attempt in range(1, attempts + 1):
        dom = run_browser(executable, url, timeout)
        title = TITLE_RE.search(dom)
        title_text = html.unescape(title.group(1)).strip() if title else ""
        if title_text.startswith(("PASS", "FAIL")):
            match = RESULTS_RE.search(dom)
            text = html.unescape(match.group(1)).strip() if match else ""
            return title_text, text, dom
        if attempt < attempts:
            print("  attempt %d/%d: the page had not finished, retrying in %ds..."
                  % (attempt, attempts, settle))
            time.sleep(settle)
    return "", "", dom


SMOKE_PAGES = [
    # the app must initialise *and* render the field note element the results panel fills in
    ("/web/index.html", r'(?s)(?=.*data-app="ready")(?=.*id="field-note")'),
    ("/site/index.html", r'(?s)(?=.*data-app="ready")(?=.*id="field-note")'),
]
PARITY_PAGES = ["/web/tests/parity.html", "/site/tests/parity.html"]
SINGLE_FILE_PAGES = [
    ("site/magcal.html", r'(?s)(?=.*data-app="ready")(?=.*id="field-note")'),
    # the offline tests page must report the full suite, not a handful of checks
    ("site/magcal-tests.html", r"1[0-9]{2} passed, 0 failed"),
]
# these two must explain themselves when opened straight from the file system
FILE_PAGES = [
    ("web/index.html", "Serve this page over HTTP"),
    ("web/tests/parity.html", "must be served over HTTP"),
]


def check_grep(executable, url, pattern, timeout):
    """Load `url` and report whether `pattern` appears in the DOM."""
    dom = run_browser(executable, url, timeout)
    if re.search(pattern, dom):
        return True, "found %s" % pattern
    return False, "did not find %s" % pattern


def check_parity(executable, url, timeout, attempts, settle):
    """Load a parity page and report its own PASS/FAIL title."""
    title, text, _ = load_page(executable, url, timeout, attempts, settle)
    if not title:
        return False, "the page never reported a result"
    failures = len(re.findall(r"^FAIL", text, flags=re.M))
    return failures == 0, title


def check_offline_copy():
    """Fail when the committed `magcal.html` is not what the sources produce right now."""
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    from tools.build_single_file import render_app

    committed = os.path.join(REPO_ROOT, "magcal.html")
    if not os.path.isfile(committed):
        return False, "magcal.html is missing - run `python tools/build_site.py`"
    with open(os.path.join(REPO_ROOT, "mag_out_sample.txt"), "r", encoding="utf-8") as handle:
        sample = handle.read()
    with open(committed, "r", encoding="utf-8") as handle:
        current = handle.read()
    if render_app(sample) == current:
        return True, "%d kB, identical to a fresh build" % (os.path.getsize(committed) // 1024)
    return False, "stale - run `python tools/build_site.py`"


CLICK_TEST_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>click test</title></head>
<body>
<pre id="out">click-test running...</pre>
<iframe id="app" src="/site/index.html" width="1200" height="900"></iframe>
<script>
// Same-origin wrapper around the real app: it clicks the actual buttons and reports what the
// app produced, so the wiring (sample button -> expected field -> Calibrate -> C block) is
// covered without a manual pass.  A missing element or a thrown error shows up as "error ...".
const out = document.getElementById("out");
const frame = document.getElementById("app");
frame.addEventListener("load", function () {
  const doc = frame.contentDocument;
  doc.getElementById("sample-button").click();
  setTimeout(function () {
    let first = "none";
    let soft = "none";
    let badge = "";
    try {
      doc.getElementById("calibrate-button").click();
      const code = doc.getElementById("c-code").textContent || "";
      badge = (doc.getElementById("quality-badge").textContent || "").trim();
      first = (code.match(/hard_iron_bias_x = [-\d.]+/) || ["none"])[0];
      soft = (code.match(/soft_iron_bias_xx = [-\d.]+/) || ["none"])[0];
    } catch (error) {
      first = "error " + error.message;
    }
    out.textContent = "RESULT field=" + doc.getElementById("field").value
      + " | " + first + " | " + soft + " | " + badge;
    document.title = "CLICKTEST-DONE";
  }, 2000);
});
</script>
</body>
</html>
"""


def check_app_click(executable, base, timeout):
    """Drive the real app: load the sample, then calibrate, and check the outcome.

    This is the only check that exercises the app's own wiring instead of the modules: the
    sample button must set the expected field to 515 (the value the capture was recorded at)
    and the C block must carry the coefficients the Python tool produces for it.
    """
    wrapper = os.path.join(REPO_ROOT, "site", "_click-test.html")
    try:
        with open(wrapper, "w", encoding="utf-8") as handle:
            handle.write(CLICK_TEST_HTML)
        dom = run_browser(executable, base + "/site/_click-test.html", timeout)
    finally:
        if os.path.isfile(wrapper):
            os.remove(wrapper)
    match = re.search(r"RESULT[^<]*", dom)
    detail = match.group(0).strip() if match else "no RESULT line in the page"
    ok = ("field=515" in detail and "hard_iron_bias_x = 41.168866" in detail
          and "soft_iron_bias_xx = 2.711938" in detail and "PASS" in detail)
    return ok, detail


def run_all(executable, port, timeout, attempts, settle):
    """Every check: HTTP smoke, both parity pages and the file:// explanations."""
    results = []
    ok, detail = check_offline_copy()
    results.append(("magcal.html (committed offline build)", ok, detail))
    site_exists = os.path.isdir(os.path.join(REPO_ROOT, "site"))
    server, _ = start_server(port)
    base = "http://127.0.0.1:%d" % port
    try:
        for path, pattern in SMOKE_PAGES:
            if path.startswith("/site/") and not site_exists:
                results.append((path, None, "skipped: run tools/build_site.py first"))
                continue
            ok, detail = check_grep(executable, base + path, pattern, timeout)
            results.append((path, ok, detail))
        for path in PARITY_PAGES:
            if path.startswith("/site/") and not site_exists:
                results.append((path, None, "skipped: run tools/build_site.py first"))
                continue
            ok, detail = check_parity(executable, base + path, timeout, attempts, settle)
            results.append((path, ok, detail))
        if site_exists:
            ok, detail = check_app_click(executable, base, timeout)
            results.append(("app click test (sample -> 515 -> Calibrate)", ok, detail))
        else:
            results.append(("app click test (sample -> 515 -> Calibrate)", None,
                            "skipped: run tools/build_site.py first"))
    finally:
        server.shutdown()
        server.server_close()

    for relative, pattern in FILE_PAGES + SINGLE_FILE_PAGES:
        path = os.path.join(REPO_ROOT, *relative.split("/"))
        if not os.path.isfile(path):
            results.append(("file://" + relative, None,
                            "skipped: run tools/build_site.py first"))
            continue
        url = "file:///" + path.replace(os.sep, "/")
        ok, detail = check_grep(executable, url, pattern, timeout)
        results.append(("file://" + relative, ok, detail))

    failed = 0
    print("%-44s %-5s %s" % ("CHECK", "STATE", "DETAIL"))
    for name, ok, detail in results:
        state = "SKIP" if ok is None else ("PASS" if ok else "FAIL")
        if ok is False:
            failed += 1
        print("%-44s %-5s %s" % (name, state, detail))
    print("\n%s (%d failure%s)" % ("FAILED" if failed else "OK", failed,
                                   "" if failed == 1 else "s"))
    return 1 if failed else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="run the browser port parity tests")
    parser.add_argument("--browser", default="chrome", choices=sorted(CANDIDATES),
                        help="which browser to drive (default: chrome)")
    parser.add_argument("--port", type=int, default=8765, help="local HTTP port")
    parser.add_argument("--timeout", type=int, default=180, help="browser timeout in seconds")
    parser.add_argument("--all", dest="all_checks", action="store_true",
                        help="run every check: HTTP smoke, both parity pages, file:// banners")
    parser.add_argument("--page", default=PAGE, help="page to load (default: %s)" % PAGE)
    parser.add_argument("--grep", default=None,
                        help="smoke mode: only check that this regex appears in the DOM")
    parser.add_argument("--attempts", type=int, default=5, help="how many times to retry")
    parser.add_argument("--settle", type=int, default=3, help="seconds between retries")
    parser.add_argument("--dump", action="store_true", help="print the raw DOM as well")
    options = parser.parse_args(argv)

    executable = find_browser(options.browser)
    if executable is None:
        print("no %s executable found; install one or run `node --test web/tests` instead"
              % options.browser)
        return 2

    if options.all_checks:
        return run_all(executable, options.port, options.timeout, options.attempts,
                       options.settle)

    server, _ = start_server(options.port)
    url = "http://127.0.0.1:%d%s" % (options.port, options.page)
    try:
        if options.grep:
            dom = run_browser(executable, url, options.timeout)
            if options.dump:
                print(dom)
            if re.search(options.grep, dom):
                print("OK: %s matched on %s" % (options.grep, options.page))
                return 0
            print("FAILED: %s was not found on %s" % (options.grep, options.page))
            print(dom[-2000:])
            return 1
        title, text, dom = load_page(executable, url, options.timeout, options.attempts,
                                     options.settle)
    finally:
        server.shutdown()
        server.server_close()

    if options.dump:
        print(dom)

    if not title:
        print("the page never reported a result - the DOM tail follows")
        print(dom[-2000:])
        return 2

    print(text)
    failures = len(re.findall(r"^FAIL", text, flags=re.M))
    print("\n%s (%d failure%s)" % ("FAILED" if failures else "OK", failures,
                                   "" if failures == 1 else "s"))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
