# Satima Farmhouse / Morning Dew Operations CMS

Phase 1: local PostgreSQL foundation for farmer registration and farmer master data. No application, authentication, payments integration or milk collection system is included.

## Requirements and first start

Docker Desktop (running), Git, Python 3, Make and a terminal. PostgreSQL client tools run inside the container; host PostgreSQL and MySQL are not used or modified.

```sh
cd ~/Developer/satima-cms
# .env is already configured locally. For a fresh clone:
# cp .env.example .env  # replace its placeholder password with a random password
make up
make migrate
make seed                 # optional; fictional development fixtures only
make test
```

`make up` waits for database health. PostgreSQL image: `postgres:18.6`; persistent Compose volume: `satima-cms_postgres_data`. PostgreSQL 18 mounts storage at `/var/lib/postgresql`. Image updates must be deliberate; major upgrades require a tested migration, not simply changing the tag.

Connection: host `127.0.0.1`, port **5433**, database **satima_cms**, user **satima_admin**. Read the password locally from `.env`; do not paste it into tickets or commands. The initial listener check showed no port 5432 listener, but Docker reported it occupied at binding time. Port 5433 was selected without stopping any existing process. Set `POSTGRES_PORT` in `.env` to change the host port, then `make up`. Access is bound to IPv4 localhost only.

Docker Desktop's bundled CLI is supported even if `docker` is absent from PATH. For nonstandard installations, add Docker to PATH.

## Daily commands

```sh
make status
make db-shell
make logs
make down                # stops containers; retains data volume
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

The local bootstrap user is an administrator, **not a future application role**. Add least-privilege application roles and authorization before real data or an API. Status changes replace soft deletion; historical consent and verification evidence is retained. General master-data change auditing and retention/deletion workflows remain future work.

Upstream references: [PostgreSQL releases](https://www.postgresql.org/docs/release/) and [Docker PostgreSQL storage guide](https://docs.docker.com/guides/postgresql/immediate-setup-and-data-persistence/).
