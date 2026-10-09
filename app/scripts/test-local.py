#!/usr/bin/env python3
from pathlib import Path
import subprocess,sys
r=Path(__file__).resolve().parents[2]
sys.exit(subprocess.run([sys.executable,str(r/'app/scripts/local-env.py'),'node','--test','app/tests/registration.test.mjs','app/tests/hosting.test.mjs']).returncode)
