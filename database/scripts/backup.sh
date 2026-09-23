#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
umask 077
file="$(mktemp "$ROOT/database/backups/satima_$(date -u +%Y%m%dT%H%M%SZ)_XXXXXX")"
trap 'rm -f "$file"' EXIT
compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$file"
mv "$file" "$file.dump"
trap - EXIT
printf '%s\n' "$file.dump"
