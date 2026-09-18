"""Build and serve the browser app locally - the one command that makes it work.

    python tools/serve.py --open

Serving is not optional: opening `web/index.html` from the file system cannot work, because
browsers block ES modules and `fetch` for `file://` pages (see docs/web-app.md).  This script
builds the site, serves the **repository root** (so both `web/` and `site/` are reachable) and
prints the URLs that do work.
"""

import argparse
import functools
import http.server
import os
import socket
import sys
import threading
import webbrowser

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

from tools.build_site import build  # noqa: E402

PAGES = [
    ("the app (sources)", "/web/"),
    ("the app (as published)", "/site/"),
    ("the offline single file", "/magcal.html"),
    ("the parity tests (sources)", "/web/tests/parity.html"),
    ("the parity tests (as published)", "/site/tests/parity.html"),
    ("the offline parity tests", "/site/magcal-tests.html"),
]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Serve the repository root without logging every request."""

    def log_message(self, *args):        # pragma: no cover - noise suppression only
        pass


def free_port(preferred, attempts=20):
    """Return `preferred`, or the next free port after it."""
    for port in range(preferred, preferred + attempts):
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit("no free port between %d and %d" % (preferred, preferred + attempts))


def main(argv=None):
    parser = argparse.ArgumentParser(description="serve the browser app locally")
    parser.add_argument("--port", type=int, default=8765, help="preferred port (default: 8765)")
    parser.add_argument("--open", action="store_true", help="open the app in the browser")
    parser.add_argument("--no-build", action="store_true", help="do not rebuild site/ first")
    options = parser.parse_args(argv)

    if not options.no_build:
        build()

    port = free_port(options.port)
    handler = functools.partial(QuietHandler, directory=REPO_ROOT)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)

    print("serving %s on http://127.0.0.1:%d/" % (REPO_ROOT, port))
    print("open one of these - do NOT double-click index.html, a file:// page cannot run the app:")
    for label, path in PAGES:
        print("  %-34s http://localhost:%d%s" % (label, port, path))
    print("press Ctrl+C to stop")

    if options.open:
        threading.Timer(0.5, webbrowser.open, args=["http://localhost:%d/web/" % port]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
