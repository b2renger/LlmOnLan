# Bundled Open WebUI launcher.
#
# The packaged sidecar is a self-contained Python (no system Python dependency)
# that runs:  python launcher.py serve --host 127.0.0.1 --port <p>
#
# Open WebUI 0.10.1's console entry point is `open_webui:app` (a Typer app) and
# there is NO `python -m open_webui` form, so we import the Typer app and drive
# it with argv. This keeps the invocation path-independent (no pip console-script
# shebang that would break once the bundle is relocated by the installer).

import sys

from open_webui import app  # Typer application (the `open-webui` CLI)

# Forward everything after `launcher.py` (e.g. `serve --host .. --port ..`).
sys.argv = ["open-webui"] + sys.argv[1:]
app()
