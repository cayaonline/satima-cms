#!/usr/bin/env python3
"""User-invoked convenience: copy only the local CMS login password on macOS."""
from pathlib import Path
import subprocess
r=Path(__file__).resolve().parents[2]
cfg=dict(line.split('=',1) for line in (r/'.env').read_text().splitlines() if line and not line.startswith('#'))
subprocess.run(['pbcopy'],input=cfg['CMS_PASSWORD'],text=True,check=True)
print('Local CMS password copied. Paste it into the sign-in form.')
