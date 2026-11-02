# Local development on macOS

This guide runs the existing Satima CMS and PostgreSQL services locally. It does not need production credentials, hosted data, or a new hosting service.

## Requirements

- Apple Silicon Mac running a current macOS release
- Git
- Docker Desktop for Mac (Apple silicon)
- Python 3 and Make (available with Xcode Command Line Tools or another trusted installation)
- Node.js 24.21.0 and npm 11 for local Node tests; the application itself runs in Docker
- Visual Studio Code (optional)

The application container uses the pinned Node.js 24.21.0 image. `.nvmrc` pins the same version for local tools. If `nvm` is not installed, follow the [official nvm installation instructions](https://github.com/nvnm-sh/nvm#installing-and-updating). Open a fresh Terminal afterward and verify `command -v nvm` returns `nvm`; if needed, run `source ~/.zshrc`. In the repository, run `nvm install` and `nvm use`; these read `.nvmrc`. Check prerequisites with `make doctor`.

## First-time setup

```sh
mkdir -p ~/Developer
git clone https://github.com/cayaonline/satima-cms.git ~/Developer/satima-cms
cd ~/Developer/satima-cms
make setup
make doctor
```

Run repository commands only after changing into the clone. Confirm with `pwd` and `ls Makefile app/package-lock.json`; running `make` or `npm ci --prefix app` from `~` will not find the project files.

`make setup` creates a private `.env` with random machine-local passwords only if it does not already exist. It never overwrites existing credentials. Keep `.env` on this computer; it is ignored by Git. If the file already exists, setup preserves it, and `make doctor` checks that its file permissions are private without displaying values. Set them to owner-only with `chmod 600 .env` if needed.

If `make setup` is run on a fresh checkout, it creates credentials, not data. Existing Docker volumes are preserved. Do not remove the volume or run `make reset-db` as routine setup.

### Run beside an existing local installation

If this Mac already has an older Satima database, start this checkout in its own Compose project and volume:

```sh
make start-isolated
```

This uses project `satima-cms-vscode`, a separate `postgres_data` volume, database port 55432, and CMS port 3001. The existing project, volume, and service on port 3000 stay in place. The new database is empty until you apply fictional fixtures with `make seed`.

Use the matching commands so tests and shutdown target the isolated stack:

```sh
make status-isolated
make app-test-isolated
make test-isolated
docker compose -p satima-cms-vscode logs -f app
make down-isolated
```

`make down-isolated` stops this checkout and preserves its new volume. The VS Code launch configurations use this isolated project automatically. Do not run `make reset-db` to resolve a migration conflict in another local installation.

## Open in VS Code

From the repository root, run `code .` or choose **File → Open Folder**. The checked-in workspace settings recommend Docker and Python extensions, hide generated folders, and provide launch entries for the isolated Docker CMS and its local Node tests. The `CMS (isolated local Docker)` launch entry is equivalent to `make start-isolated`; start Docker Desktop first.

## Start, inspect and stop

```sh
make start
```

The command waits for the database health check, applies pending numbered migrations, configures the restricted `satima_app` role, then builds and starts the Node app. Visit http://127.0.0.1:3000. For the local Admin password, run `make copy-password`; it copies the password to the macOS clipboard without printing it. The Admin login username is `admin`.

```sh
make status
make logs                         # PostgreSQL logs
docker compose logs -f app        # app logs
make db-shell                    # local PostgreSQL administrator shell
make down                        # stop app and database, keep database records
make start                       # restart and apply any pending migrations
```

`make up` starts only the Compose services. `make start` is the usual start/restart command because it also migrates, configures the local app role, and rebuilds the app. The database listens on `127.0.0.1:${POSTGRES_PORT}` (5433 in the example); the CMS listens on `127.0.0.1:${CMS_PORT}` (3000 by default). Both ports can be changed in `.env`.

Compose stores records in the named `postgres_data` volume (`satima-cms_postgres_data` for the default project name), not in the app container. Rebuilding the app and `make down` retain records. Avoid `docker compose down -v` and `make reset-db`: those delete the project database volume.

## Tests and database checks

Install the locked Node dependencies once, start the migrated local stack, then run the app tests:

```sh
npm ci --prefix app
make start
make app-test
```

The app test command runs all `app/tests/*.test.mjs` cases with the local database credentials loaded privately from `.env`. It enables the isolated database cases, which use synthetic records and roll back their transactions. Registration tests need the local migrated database and `satima_app` role; the HTTP integration test also needs the app running on `CMS_PORT`.

Run database integrity checks separately:

```sh
make test
```

This executes `database/tests/integrity.sql` in a transaction and rolls back its synthetic rows. Sequence gaps from checks are expected. No tests require real registrations. Do not run tests against Neon or another hosted database.

For debugging, start the services with `make start`, then use the VS Code `Node tests (local DB)` launch entry or run `npm test --prefix app`. Application logs: `docker compose logs -f app`; PostgreSQL logs: `make logs`.

CI uses a disposable PostgreSQL 18.6 service and CI-only credentials. It applies repository migrations and runs the same app test suite; its GitHub token has read-only repository permission.

## Local backups

`make backup` writes a PostgreSQL custom-format dump under `database/backups/`, with restrictive permissions. The directory is ignored by Git. Copy backups to encrypted storage with access limited to the data owner; a backup may contain personal data if real records were ever imported. Back up source documents separately and keep them out of the repository.

Restore only into the intended local database after reviewing the target and keeping a separate backup. `make restore FILE=/absolute/path/to/backup.dump` requires typing `RESTORE` and replaces matching objects in the configured database. For routine protection, use backups and `make down`; never use reset as a troubleshooting shortcut.

## Environment boundaries

Local `.env` contains only local passwords, and Compose targets its own PostgreSQL service. Test/CI databases are isolated and synthetic. Production uses separate Render and Neon credentials and personal data; these are not part of local setup. Do not copy production data into fixtures, local test databases, issues, logs, or Git. Do not run `app/scripts/*hosted*` for local development.

Production architecture and release guidance is in [Render deployment](render-deployment.md). It is reference documentation only; local commands above do not deploy or change hosted services.

## Troubleshooting

- **Docker not found:** install Docker Desktop for Apple silicon. The scripts also check the standard Docker Desktop CLI path when it is not on `PATH`.
- **Docker installed but unavailable:** open Docker Desktop and wait until the engine is running, then retry `make doctor`.
- **`.env` missing:** run `make setup`. If it exists, setup preserves it. Never commit it.
- **Permission warning:** run `chmod 600 .env` and rerun `make doctor`.
- **Port already allocated:** change `POSTGRES_PORT` or `CMS_PORT` in `.env`, then run `make start`. Ports bind to loopback only.
- **Database unhealthy or app cannot connect:** inspect `make status`, `make logs`, and `docker compose logs app`; then retry `make start`. Preserve the volume while diagnosing.
- **Node version mismatch / npm tests fail to start:** install Node.js 24.21.0 (`nvm install` and `nvm use`) and run `npm ci --prefix app`.
- **App tests cannot connect:** confirm `make start` completed and `satima_app` role was configured. The host connection values are in private `.env`; do not paste passwords into command arguments.
- **Migration checksum error:** an applied migration file differs from the recorded checksum. Do not edit the migration ledger or reset the database. Restore the original file from Git and add a new numbered migration for any schema change.
- **Startup reports configuration failure:** run `make doctor`, verify required keys exist in `.env` without sharing their values, and inspect the relevant service logs.

## Implementation notes

PostgreSQL uses the official `postgres:18.6` image and PostgreSQL 18 volume path. Migrations run in filename order, transactionally, with a session advisory lock and SHA256 verification. Applied migrations are immutable. `make down` preserves the Compose volume; `make reset-db` is explicitly destructive and should not be needed for development.
