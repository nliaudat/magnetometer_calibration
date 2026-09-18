"""Assemble the static site that GitHub Pages publishes.

The repository is a Python package, so the site is built into `site/` instead of publishing
the repository root:

    site/index.html, app.js, style.css, js/       the app (copied from `web/`)
    site/tests/                                   the parity test page and its fixture
    site/samples/mag_out_sample.txt               the capture the "load the sample" button uses
    site/.nojekyll                                no Jekyll processing (the artifact is final)

Run: ``python tools/build_site.py``  ->  ``site/``
"""

import argparse
import os
import shutil
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:                    # so `tools.build_single_file` is importable
    sys.path.insert(0, REPO_ROOT)

WEB = os.path.join(REPO_ROOT, "web")
SITE = os.path.join(REPO_ROOT, "site")
SAMPLE = os.path.join(REPO_ROOT, "mag_out_sample.txt")


def copy_tree(source, destination):
    """Copy a directory, replacing what was there."""
    if os.path.isdir(destination):
        shutil.rmtree(destination)
    shutil.copytree(source, destination,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))


def copy_sample(directory):
    """Copy the capture the app's "load the sample" button needs into `<directory>/samples`."""
    samples = os.path.join(directory, "samples")
    os.makedirs(samples, exist_ok=True)
    shutil.copy2(SAMPLE, os.path.join(samples, "mag_out_sample.txt"))
    return samples


def build(site=SITE):
    """Assemble `site/` from `web/` and the repository data files.

    Also drops a copy of the sample capture into `web/samples/` (git-ignored) so that serving
    `web/` directly - or opening `tools/serve.py`'s first URL - finds it next to the app.
    """
    if os.path.isdir(site):
        shutil.rmtree(site)
    os.makedirs(site)

    for name in ("index.html", "app.js", "style.css"):
        shutil.copy2(os.path.join(WEB, name), os.path.join(site, name))
    copy_tree(os.path.join(WEB, "js"), os.path.join(site, "js"))
    copy_tree(os.path.join(WEB, "tests"), os.path.join(site, "tests"))
    copy_sample(site)
    copy_sample(WEB)

    # The self-contained pages are part of the published site (and prove that the modules can
    # be bundled): site/magcal.html works by double-clicking, site/magcal-tests.html runs this
    # port's parity suite offline.
    from tools.build_single_file import build as build_single_file
    build_single_file(site, verbose=False)

    # An empty .nojekyll keeps GitHub Pages from running Jekyll over the built artifact.
    with open(os.path.join(site, ".nojekyll"), "w", encoding="utf-8"):
        pass

    # Keep a copy of the offline single file at the repository root, so it is easy to find,
    # easy to double-click, and attachable to a release unchanged.
    offline = os.path.join(site, "magcal.html")
    if os.path.isfile(offline):
        shutil.copy2(offline, os.path.join(REPO_ROOT, "magcal.html"))

    files = sum(len(names) for _, _, names in os.walk(site))
    size = sum(os.path.getsize(os.path.join(root, name))
               for root, _, names in os.walk(site) for name in names)
    print("built %s: %d files, %.0f kB" % (os.path.relpath(site, REPO_ROOT), files, size / 1024.0))
    return site


def main(argv=None):
    parser = argparse.ArgumentParser(description="build the GitHub Pages site")
    parser.add_argument("--site", default=SITE, help="output directory (default: site/)")
    options = parser.parse_args(argv)
    build(options.site)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
