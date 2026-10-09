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

.PHONY: start app-test
start:
	@bash -c 'source database/scripts/common.sh; compose up -d --wait postgres'
	@$(MAKE) migrate
	@python3 database/scripts/configure-app.py
	@bash -c 'source database/scripts/common.sh; compose up -d --build --wait app'
app-test:
	@python3 app/scripts/test-local.py

.PHONY: copy-password
copy-password:
	@python3 app/scripts/copy-password.py
