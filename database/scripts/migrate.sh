#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
python3 database/scripts/migrate.py | psql_db
