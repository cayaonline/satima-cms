#!/usr/bin/env python3
"""Apply the local application role password without printing it or putting it in argv."""
from pathlib import Path
import shutil, subprocess
r=Path(__file__).resolve().parents[2]
cfg=dict(line.split('=',1) for line in (r/'.env').read_text().splitlines() if line and not line.startswith('#'))
secret=cfg.get('APP_DB_PASSWORD','')
if len(secret)<16: raise SystemExit('Set APP_DB_PASSWORD in .env to a random password of at least 16 characters.')
docker=shutil.which('docker') or '/Applications/Docker.app/Contents/Resources/bin/docker'
p=subprocess.run([docker,'compose','--project-directory',str(r),'exec','-T','postgres','sh','-c','exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],input=(r/'database/migrations/008_application_role.sql').read_text()+"\nALTER ROLE satima_app PASSWORD '"+secret.replace("'","''")+"';\n",text=True,capture_output=True)
if p.returncode: raise SystemExit('Could not configure the application role. Check database availability and run migrations first.')
print('Application database role configured; credential not displayed.')
