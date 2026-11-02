#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
if [[ ! -f "$ROOT/.env" ]]; then
 echo 'Local .env is missing. Run `make setup` to create private local credentials.' >&2; exit 1
fi
if command -v docker >/dev/null 2>&1; then DOCKER="$(command -v docker)";
elif [[ -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
 DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
else echo 'Docker Desktop is required. Install/start it, then retry.' >&2; exit 1; fi
if ! "$DOCKER" info >/dev/null 2>&1; then
 echo 'Docker is installed but unavailable. Start Docker Desktop and wait for it to finish starting.' >&2; exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
 echo 'Python 3 is required for migrations and local scripts. Install Python 3, then retry.' >&2; exit 1
fi
compose() { "$DOCKER" compose --project-directory "$ROOT" --env-file "$ROOT/.env" "$@"; }
psql_db() { compose exec -T postgres sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"; }
