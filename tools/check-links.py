#!/usr/bin/env python3
"""Fails if any internal link or asset reference in the built HTML is broken.

GitHub Pages has no server to rewrite URLs, so a typo in an href is a 404 that
only shows up when someone clicks it. This walks every generated page, collects
each local href/src, and checks that the target exists on disk.

    python3 tools/check-links.py

Exit code 1 on any broken reference.
"""

import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
PAGES = ("index.html", "install.html")

# href="..." or src="...", single or double quoted.
REF = re.compile(r'(?:href|src)\s*=\s*"([^"]+)"', re.I)


def is_external(url: str) -> bool:
    """Anything with a scheme or a protocol-relative host is not our problem."""
    return bool(urlparse(url).scheme) or url.startswith("//")


def main() -> int:
    broken = []
    checked = 0

    for page in PAGES:
        path = ROOT / page
        if not path.exists():
            broken.append(f"{page}: page is missing")
            continue

        for ref in REF.findall(path.read_text()):
            ref = ref.strip()
            if not ref or ref.startswith("#") or is_external(ref):
                continue

            # Split the fragment: "#main" is not a file, "install.html#steps" is.
            target, _, fragment = ref.partition("#")
            if not target:
                continue

            checked += 1
            resolved = (ROOT / unquote(target)).resolve()

            # A link may not escape the site root.
            if ROOT not in resolved.parents and resolved != ROOT:
                broken.append(f"{page}: {ref} points outside the site")
                continue

            if not resolved.exists():
                broken.append(f"{page}: {ref} does not exist")
                continue

            # An anchor must exist in the target document.
            if fragment and resolved.suffix == ".html":
                body = resolved.read_text()
                if f'id="{fragment}"' not in body:
                    broken.append(f"{page}: {ref} has no matching id")

    if broken:
        print("Broken references:", file=sys.stderr)
        for item in broken:
            print(f"  {item}", file=sys.stderr)
        return 1

    print(f"OK: {checked} internal references across {len(PAGES)} pages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
