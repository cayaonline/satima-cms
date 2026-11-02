# Satima Farmhouse CMS

Satima CMS is a Node.js application with a PostgreSQL 18 database and browser-based Admin and Operations interfaces. The existing Compose workflow provides local development; this phase improves its setup and documentation without changing application screens or business behavior.

## Local development

See [Local development](docs/local-development.md) for Mac requirements, first-time setup, VS Code, tests, debugging, local data, backups, and troubleshooting.

Quick start from a clone:

```sh
make setup       # creates .env only when absent; existing credentials are preserved
make doctor      # checks Docker, Node.js, Python and private .env permissions
make start       # starts PostgreSQL, applies migrations, configures app role, starts CMS
make app-test    # runs the complete Node test suite against the local database
make test        # runs rollback-only PostgreSQL integrity checks
```

Open http://127.0.0.1:3000. Use `make logs` to follow PostgreSQL logs, `docker compose logs -f app` for application logs, and `make down` to stop services while preserving the named database volume. `make up` restarts the database only; `make start` also migrates and starts/rebuilds the app.

The local app binds to loopback and uses the Compose PostgreSQL service. The committed SQL fixtures are fictional; do not add production records or credentials to Git. `.env`, local backups, and private documents are ignored by Git.

## Environments

- **Local development:** private machine `.env`, Docker Compose PostgreSQL on localhost, and synthetic test fixtures. This is the default development target.
- **Testing/CI:** disposable isolated PostgreSQL databases with synthetic credentials and data. Never point test commands at a hosted database.
- **Production:** separate Render and Neon configuration, credentials, and data. Local setup and CI do not require or use those credentials. Never use a production URL in a local `.env`.

Production deployment instructions are retained in [Render deployment](docs/render-deployment.md) for reference. Phase 0 does not deploy, alter hosting settings, or access production.

## Existing documentation

- [Database schema](docs/database-schema.md)
- [Data privacy and security](docs/data-privacy.md)
- [Validation notes](docs/validation.md)
- [Farmer management](docs/farmer-management.md)
- [Render deployment](docs/render-deployment.md)

Milk collection, processing and payment integrations are outside this CMS. Changes to the Admin or Operations workflows require explicit product review.
