#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
file="${1:?Usage: restore.sh /absolute/path/backup.dump}"
[[ -f "$file" ]] || { echo 'Backup not found' >&2; exit 1; }
# Validate archive before asking to replace data.
compose exec -T postgres pg_restore --list < "$file" >/dev/null
echo 'WARNING: This will replace matching objects and data in this project database.'
echo 'Stop application writers first. Make a backup before restoring.'
read -r -p 'Type RESTORE to continue: ' answer
[[ "$answer" == RESTORE ]] || { echo 'Cancelled'; exit 1; }
compose exec -T postgres sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl --exit-on-error --single-transaction' < "$file"
