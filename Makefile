.PHONY: up down status logs db-shell migrate seed test reset-db backup restore schema
up down status logs db-shell seed test schema:
	@bash database/scripts/run.sh $@
migrate:
	@bash database/scripts/migrate.sh
backup:
	@bash database/scripts/backup.sh
restore:
	@bash database/scripts/restore.sh "$(FILE)"
reset-db:
	@bash database/scripts/reset-db.sh
