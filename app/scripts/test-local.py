#!/usr/bin/env python3
from pathlib import Path
import os,subprocess,sys
r=Path(__file__).resolve().parents[2]
env=os.environ.copy();env['TEST_ISOLATED_DATABASE']='1'
sys.exit(subprocess.run([sys.executable,str(r/'app/scripts/local-env.py'),'npm','test','--prefix','app'],env=env).returncode)
