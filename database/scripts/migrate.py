#!/usr/bin/env python3
"""Generate one psql session: advisory lock + per-migration transaction + SHA256 ledger."""
from pathlib import Path
import hashlib
root = Path(__file__).resolve().parents[2]
print("\\set ON_ERROR_STOP on")
print("SELECT pg_advisory_lock(728410022);")
print("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());")
for path in sorted((root / 'database/migrations').glob('*.sql')):
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    name = path.name
    if not all(c.isalnum() or c in '._-' for c in name):
        raise ValueError('Unsafe migration filename')
    print(f"SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version='{name}') AS applied \\gset")
    print("\\if :applied")
    print(f"DO $check$ BEGIN IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version='{name}' AND checksum='{checksum}') THEN RAISE EXCEPTION 'Applied migration checksum mismatch: {name}'; END IF; END $check$;")
    print("\\else\nBEGIN;")
    print(path.read_text())
    print(f"INSERT INTO schema_migrations(version, checksum) VALUES ('{name}', '{checksum}');")
    print("COMMIT;\n\\endif")
print("SELECT pg_advisory_unlock(728410022);")
