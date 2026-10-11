# Satima Farmhouse / Morning Dew Operations CMS

Local farmer registration and master-data workspace: PostgreSQL, a small Node.js API, and a browser interface. The current local database includes 22 paper-form registrations with deferred cleaning notes. Real records are not included in GitHub clones. Milk collection, processing and payment integrations are not built.

## Open the local CMS

Start Docker Desktop, then:

```sh
cd ~/Developer/satima-cms
make start
make copy-password
```

Open **http://127.0.0.1:3000**, enter the username `admin`, and paste the copied password into the login screen. `make copy-password` copies only `CMS_PASSWORD` from `.env` to your macOS clipboard; it does not print the password. Existing installation credentials are already configured. `make start` starts PostgreSQL, checks migrations, configures the separate app role and builds/starts the application.

The directory defaults to actual registrations. Demo records remain stored and are visible in All records; they are never deleted automatically. Open a farmer to edit master/contact/payment details or see consent, verification, source transcription, change history and cleaning notes. New records default to pending verification. Marking a note resolved requires an explanation and does not silently alter consent evidence.

## Run on another computer

See [installation and private database transfer](docs/other-computers.md). Run `make setup` on a fresh clone to create per-computer credentials, then `make start`. Separate local copies do not synchronize; a shared live database requires a hosting service.

## Shared online deployment

[Deploy on Render](https://render.com/deploy?repo=https://github.com/cayaonline/satima-cms) using the prepared [hosting and private data-transfer guide](docs/render-deployment.md). This uses a free Render web service and a separate Neon Free PostgreSQL database. A new deployment is empty until the private database is transferred. The eventual Render HTTPS service URL is the shared application link.

The administrator CMS remains at `/` with username `admin`. The separate read-only [Morning Dew Operations Portal](https://satima-cms.onrender.com/operations/login) signs in as `operations` at `/operations/login` and displays approved farmer information at `/operations`; it shares the same PostgreSQL database but uses a distinct viewer password and restricted API responses. Configure the viewer credential outside Git as described in [production maintenance](docs/production-maintenance.md).

## Requirements and first start

Docker Desktop (running), Git, Python 3, Make and a terminal. Local development tests additionally use Node.js and `npm ci --prefix app`; the running app needs no host Node installation. PostgreSQL client tools run inside the container; host PostgreSQL and MySQL are not used or modified.

```sh
cd ~/Developer/satima-cms
# .env is already configured locally. For a fresh clone:
make setup               # creates credentials only if .env does not exist
make start
make seed                 # optional; fictional development fixtures only
make test
```

`make up` waits for database health. PostgreSQL image: `postgres:18.6`; persistent Compose volume: `satima-cms_postgres_data`. PostgreSQL 18 mounts storage at `/var/lib/postgresql`. Image updates must be deliberate; major upgrades require a tested migration, not simply changing the tag.

Connection: host `127.0.0.1`, port **5433**, database **satima_cms**, user **satima_admin**. Read the password locally from `.env`; do not paste it into tickets or commands. The initial listener check showed no port 5432 listener, but Docker reported it occupied at binding time. Port 5433 was selected without stopping any existing process. Set `POSTGRES_PORT` in `.env` to change the host port, then `make up`. Access is bound to IPv4 localhost only.

Docker Desktop's bundled CLI is supported even if `docker` is absent from PATH. For nonstandard installations, add Docker to PATH.

## Daily commands

```sh
make status
make start               # migrate and rebuild the app after code changes
make copy-password       # copy local login password, without displaying it
make app-test            # Node tests; requires npm ci --prefix app
make db-shell
make logs
make down                # stops app and database; retains data volume
make up
make migrate             # skips applied migrations; checks SHA256 hashes
make seed                # inserts missing fixtures by fixed UUID, does not update them
make test                # rollback-only SQL tests; sequence gaps are expected
make schema              # refresh schema-only SQL snapshot
make backup              # prints path to a private custom-format dump
make restore FILE=/absolute/path/to/backup.dump
make reset-db            # interactive confirmation; deletes this project's volume
```

Restore warns and requires typing `RESTORE`. It uses `pg_restore --clean --if-exists --single-transaction` against the configured database; matching archived objects are replaced and objects absent from the archive are not removed. For an exact clone, restore into a new empty database. Reset requires typing `DELETE SATIMA`, removes the project volume (all databases inside it), starts PostgreSQL and reapplies migrations. It does not automatically seed. Neither command targets host databases. Back up first and stop application writers before either operation. `make down` is the normal nondestructive stop.

## Migrations and identifiers

Run `make migrate` explicitly after startup. Numbered SQL migrations apply once, in filename order, each in a transaction. A session advisory lock serializes runners; `schema_migrations` records SHA256 checksums. Applied files must never be edited: add a new migration. Failures stop immediately; earlier committed migrations remain applied and can safely be retried. Python 3 generates the psql input; no extra Python packages are required.

UUIDs use built-in `gen_random_uuid()`. `customer_id` uses an atomic PostgreSQL sequence: `SF-F-0001` through `SF-F-9999`, then `SF-F-10000` and beyond without truncation. It is unique, indexed and immutable after insert. Omit it on ordinary inserts. Sequence gaps after rollbacks, failed inserts or tests are expected; IDs are not gapless. Controlled imports that override IDs must advance the sequence under an exclusive maintenance lock. Fixtures receive 0001–0005 only on a pristine database before tests. All relationships use UUIDs.

## Design and reference

- [Schema and column dictionary](docs/database-schema.md)
- [ER diagram](docs/erd.md)
- [Form mapping](docs/farmer-registration-field-mapping.md)
- [Paper form review](docs/form-review-notes.md)
- [Privacy and security boundaries](docs/data-privacy.md)
- [Future schema and technical debt](docs/future-schema.md)
- [Inspection SQL](database/schema/sample-queries.sql)
- [Validation report](docs/validation.md)

The application uses the restricted `satima_app` database role, not the administrator. A shared operator password protects all farmer endpoints; cookies are HttpOnly/SameSite=Strict, writes require the configured Origin, and sessions expire after eight hours or app restart. Local services bind to localhost. The optional Render deployment uses HTTPS, Secure cookies and the same shared operator login; it does not provide individual staff identities. Share access only with trusted operators.

Consent and verification now support NULL = not recorded. Source references and original transcriptions remain separate from editable records. Database triggers audit inserts/updates with before/after values; the application cannot modify audit rows or delete farmers. App edits are attributed to Local operator; this is not individual staff identity.

See [current app and data-cleaning notes](docs/farmer-management.md). Real PDF files, transcriptions and browser screenshots are kept under ignored `data/private/`, with private permissions. Backups now contain real PII and audit values: keep them private. The source PDF must be backed up separately from PostgreSQL. Original test fixtures remain fictional; never seed real records through source-controlled SQL.

Upstream references: [PostgreSQL releases](https://www.postgresql.org/docs/release/) and [Docker PostgreSQL storage guide](https://docs.docker.com/guides/postgresql/immediate-setup-and-data-persistence/).
