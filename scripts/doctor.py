#!/usr/bin/env python3
"""Check local prerequisites without reading or displaying credential values."""
from pathlib import Path
import os
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
issues = []

def check(label, command):
    path = shutil.which(command)
    if not path:
        issues.append(f'{label} is missing from PATH.')
        return
    result = subprocess.run([path, '--version'], text=True, capture_output=True)
    version = (result.stdout or result.stderr).strip().splitlines()
    print(f'{label}: {version[0] if version else "available"}')

check('Python', 'python3')
node_path = shutil.which('node')
npm_path = shutil.which('npm')
expected_node = (root / '.nvmrc').read_text().strip()
if not node_path:
    issues.append('Node.js is missing from PATH. Install the version in .nvmrc for local tests.')
else:
    node_version = subprocess.run([node_path, '--version'], text=True, capture_output=True).stdout.strip().lstrip('v')
    print(f'Node.js: {node_version}')
    if node_version != expected_node:
        issues.append(f'Node.js {expected_node} is required by .nvmrc; currently active version is {node_version}.')
if not npm_path:
    issues.append('npm is missing from PATH. Install Node.js ' + expected_node + ' (npm 11 is required).')
else:
    npm_version = subprocess.run([npm_path, '--version'], text=True, capture_output=True).stdout.strip()
    print(f'npm: {npm_version}')
    if not npm_version.startswith('11.'):
        issues.append(f'npm 11.x is required; currently active version is {npm_version}.')
docker = shutil.which('docker') or '/Applications/Docker.app/Contents/Resources/bin/docker'
if not Path(docker).is_file():
    issues.append('Docker Desktop CLI is missing. Install Docker Desktop for Apple silicon.')
elif subprocess.run([docker, 'info'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
    issues.append('Docker Desktop is installed but not running. Start it, then retry.')
else:
    print('Docker Desktop: running')

env_file = root / '.env'
if not env_file.exists():
    issues.append('Private .env is missing. Run `make setup`.')
else:
    mode = env_file.stat().st_mode & 0o777
    if mode & 0o077:
        issues.append(f'.env permissions are {mode:o}; run `chmod 600 .env`.')
    else:
        print('Private .env: present (values not inspected or displayed)')
    keys = {line.partition('=')[0] for line in env_file.read_text().splitlines() if line and not line.startswith('#')}
    required = {'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_PORT', 'APP_DB_PASSWORD', 'CMS_PASSWORD', 'CMS_PORT'}
    missing = required - keys
    if missing:
        issues.append('Local .env is missing required keys: ' + ', '.join(sorted(missing)))

if issues:
    print('\nSetup issues:')
    for issue in issues:
        print(f'- {issue}')
    sys.exit(1)
print('Local development prerequisites look ready.')
