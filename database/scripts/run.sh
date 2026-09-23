#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
case "${1:-}" in
 up) compose up -d --wait ;;
 down) compose down ;;
 status) compose ps ;;
 logs) compose logs --tail=100 -f postgres ;;
 db-shell) compose exec postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB"' ;;
 seed) psql_db < database/seeds/001_fictional_farmers.sql ;;
 test) psql_db < database/tests/integrity.sql ;;
 schema) compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --schema-only --no-owner --no-acl' > database/schema/schema.sql ;;
 *) echo 'Unknown command' >&2; exit 1 ;;
esac
