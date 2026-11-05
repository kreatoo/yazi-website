"""Page bodies, assembled from one module per page."""

from pages_titles import TITLES, DESCRIPTIONS
from pages_index import INDEX
from pages_install import INSTALL

BODIES = {
    "index": INDEX,
    "install": INSTALL,
}

__all__ = ["BODIES", "TITLES", "DESCRIPTIONS"]
