#!/usr/bin/env python3
"""Create private per-machine credentials without replacing an existing .env."""
from pathlib import Path
import os
import secrets

root = Path(__file__).resolve().parents[1]
target = root / '.env'
if target.exists():
    print('Existing .env preserved. Run make start to use this installation.')
else:
    lines = []
    for line in (root / '.env.example').read_text().splitlines():
        key, separator, value = line.partition('=')
        if key in {'POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'CMS_PASSWORD'}:
            value = secrets.token_urlsafe(24)
        lines.append(key + separator + value)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write('\n'.join(lines) + '\n')
    print('Created private .env with new credentials for this computer. Run make start.')
