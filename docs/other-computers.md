# Run the existing CMS on another computer

The GitHub repository contains the application and database schema. Real farmer data, source PDFs, passwords and database backups are deliberately excluded. Each local installation has its own database and password. Local copies do not synchronize.

## Install on a Mac or Linux computer

Install and start Docker Desktop (or Docker Engine with Compose on Linux), plus Git, Python 3 and Make. Windows users can run these commands inside a WSL2 Linux environment with Docker Desktop integration enabled.

Authenticate to GitHub with an account that can access the private repository, then:

```sh
git clone https://github.com/cayaonline/satima-cms.git
cd satima-cms
make setup
make start
```

`make setup` creates unique private credentials in `.env`. It never replaces an existing `.env`. Open http://127.0.0.1:3000. On a Mac, run `make copy-password` and paste into the login form. On another OS, read `CMS_PASSWORD` from the local `.env` file. This new installation starts with no farmers. Do not seed fictional records if you intend to restore the real database.

## Copy the existing farmer database

On the source Mac, run `make backup`. Transfer the resulting `.dump` file directly to the other authorized computer using a private transfer method. Transfer source PDFs separately if they are needed for verification. Do not upload either to GitHub, issues, releases or public file links.

On the destination, after its first `make start`:

```sh
make backup  # preserve any destination data before replacing it
# Stop only the application; keep PostgreSQL running.
bash -c 'source database/scripts/common.sh; compose stop app'
make restore FILE=/absolute/path/to/the-transferred-backup.dump
make start
```

The restore command asks you to type `RESTORE` because it replaces matching database objects and data. Use a fresh installation for an exact independent copy. Source customer IDs, relationships, source transcriptions, cleaning notes and audit history are included in the dump. Destination credentials remain local to that computer.

Check the registered count and customer IDs in the directory after restoring. `make down` stops the application without removing its database volume. Never run `make reset-db` on data you intend to keep.

## One shared database for multiple computers

For everyone to see and edit the same live records, deploy this Node.js application and PostgreSQL together on an application/database hosting service, or use a reviewed private-network setup. GitHub Pages hosts static websites; it cannot run this Node server or PostgreSQL. Publishing the repository is not a live hosted deployment.

The current application intentionally accepts only localhost requests. A shared deployment needs a selected host, HTTPS, an allowed application origin, secure session cookies, and an access model for the intended operators. Do not expose port 5433 or remove the origin checks to work around this. The existing interface can remain unchanged.

Reference: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
