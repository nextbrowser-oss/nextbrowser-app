#!/usr/bin/env python3
"""Build the optional Browser Use engine as a self-contained sidecar."""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "browser-engine" / "worker.py"
WORK = ROOT / "browser-engine" / "build"
DIST = ROOT / "browser-engine" / "dist"
NAME = "nextbrowser-browser-engine"

shutil.rmtree(WORK, ignore_errors=True)
shutil.rmtree(DIST, ignore_errors=True)
subprocess.run([
    sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
    "--name", NAME, "--distpath", str(DIST), "--workpath", str(WORK),
    "--specpath", str(WORK), "--collect-submodules", "browser_use.browser",
    "--collect-submodules", "browser_use.dom", "--collect-submodules", "browser_use.actor",
    "--collect-submodules", "mcp.server", str(SOURCE),
], cwd=ROOT, check=True)
shutil.copy2(ROOT / "browser-engine" / "LICENSE.browser-use", DIST / NAME / "LICENSE.browser-use")
print(DIST / NAME)
