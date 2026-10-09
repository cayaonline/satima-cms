#!/usr/bin/env python3
"""Run local Node tools with private credentials in the environment, never argv."""
from pathlib import Path
import os,subprocess,sys
r=Path(__file__).resolve().parents[2]
cfg=dict(line.split('=',1) for line in (r/'.env').read_text().splitlines() if line and not line.startswith('#'))
env=os.environ.copy();env.update(PGHOST='127.0.0.1',PGPORT=cfg['POSTGRES_PORT'],PGDATABASE=cfg['POSTGRES_DB'],PGUSER='satima_app',PGPASSWORD=cfg['APP_DB_PASSWORD'],CMS_PASSWORD=cfg['CMS_PASSWORD'],CMS_PORT=cfg['CMS_PORT'])
sys.exit(subprocess.run(sys.argv[1:],env=env,cwd=r).returncode)
