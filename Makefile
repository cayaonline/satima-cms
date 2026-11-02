.PHONY: up down status logs db-shell migrate seed test reset-db backup restore schema doctor
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

.PHONY: setup
setup:
	@command -v python3 >/dev/null 2>&1 || { echo 'Python 3 is required. Install Python 3, then retry.' >&2; exit 1; }
	@python3 scripts/setup-local.py

doctor:
	@command -v python3 >/dev/null 2>&1 || { echo 'Python 3 is required. Install Python 3, then retry.' >&2; exit 1; }
	@python3 scripts/doctor.py

# Run this checkout beside an older local installation without reusing its database volume.
ISOLATED_ENV = COMPOSE_PROJECT_NAME=satima-cms-vscode POSTGRES_PORT=55432 CMS_PORT=3001
.PHONY: start-isolated down-isolated status-isolated logs-isolated app-test-isolated test-isolated seed-isolated
start-isolated:
	@$(ISOLATED_ENV) $(MAKE) start
down-isolated:
	@$(ISOLATED_ENV) $(MAKE) down
status-isolated:
	@$(ISOLATED_ENV) $(MAKE) status
logs-isolated:
	@$(ISOLATED_ENV) $(MAKE) logs
app-test-isolated:
	@$(ISOLATED_ENV) $(MAKE) app-test
test-isolated:
	@$(ISOLATED_ENV) $(MAKE) test
seed-isolated:
	@$(ISOLATED_ENV) $(MAKE) seed
