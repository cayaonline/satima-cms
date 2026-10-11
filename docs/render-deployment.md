# Shared online CMS: Render Free + Neon Free

Live application: **https://satima-cms.onrender.com**. Deployed and verified 10 October 2026 on Render Free and Neon Free (PostgreSQL 18, Frankfurt), without adding a payment card. All 22 actual registrations and 5 separate demos were transferred privately; customer IDs and all nine database tables matched the Mac copy after restore. HTTPS login, search, profile evidence, write validation and logout passed. Cloud login details are kept in an ignored private local file and in Render secrets.

The existing CMS runs on one free Render Node web service. Its persistent PostgreSQL database is hosted separately on Neon Free. The interface, schema and registration behavior are preserved. GitHub contains code only; farmer records, PDFs, backups and credentials remain private.

## Setup

1. Sign in to Neon with GitHub and create a **Free** PostgreSQL 18 project in Frankfurt. Create the database named `satima_cms`. Do not enable optional authentication, Data API or paid features.
2. Back up the existing Mac database with `make backup`. Transfer it only after the owner approves storing farmer identity, contact, next-of-kin, M-Pesa and verification information in their Neon project.
3. Restore the private dump into the new, unused Neon database with PostgreSQL 18 `pg_restore --no-owner --no-acl --single-transaction`. Use a direct connection, not a pooler, and TLS with certificate verification. Keep credentials in private environment variables or a mode-600 password file. Never put credentials in shell arguments or Git. Confirm the destination is empty before restoring.
4. Run `node app/scripts/migrate-hosted.mjs` locally with private `ADMIN_DATABASE_URL` and a freshly generated `APP_DB_PASSWORD`. This verifies the restored migration hashes and configures `satima_app` with existing grants. The app cannot delete farmers or alter audit history.
5. Deploy `cayaonline/satima-cms` as a **Free** Render web service, either manually or using `render.yaml`. Build command: `npm ci --prefix app --omit=dev --ignore-scripts`. Start command: `node app/scripts/start-hosted.mjs`. Health check: `/health`. Choose Frankfurt and disable automatic deploys.
6. Configure `CMS_PASSWORD`, `NODE_VERSION=24.21.0` and `DATABASE_URL` on Render. The database URL must use the restricted `satima_app` role, database `satima_cms`, and `sslmode=verify-full`. Use Neon's direct endpoint. Keep the schema-owner connection on the Mac; Render does not need it. The Admin Panel uses username `admin` and `CMS_PASSWORD`, which is different from the Mac's password. To enable the separate read-only Operations Portal, configure `VIEWER_USERNAME=operations` and `VIEWER_PASSWORD_HASH` as private environment variables; see [production maintenance](production-maintenance.md#authentication). Never put the plaintext viewer password in Render or GitHub.
7. Wait for Render to report **Live**. Its displayed HTTPS URL is the link to share with trusted operators. Verify login, 22 actual registrations plus 5 separate demo records, customer-ID uniqueness, searching and authorized edits.

No seed data runs automatically. A fresh deployment without a private restore has an empty directory. Existing Mac and hosted databases do not synchronize: use the shared service for ongoing work after cutover and retain the Mac database as a backup copy. Back up original PDFs separately.

## Free-plan behavior

Render sleeps after 15 minutes without traffic; the next visit can take about a minute to wake it. Sessions are stored in memory and expire after eight hours or restart, so waking/redeploying can require signing in again. Keep a single web instance. All operators still share the same login and audit actor.

Neon Free has storage and compute quotas. Its database compute can sleep independently; data persists outside the web container. Keep periodic private backups. Check current dashboard quotas before growing the service. This is free-tier hosting without a production uptime guarantee.

The blueprint creates no Render database and uses no paid compute. No payment card is configured. Render can request card verification for some accounts; stop if this occurs rather than switching to a paid plan.

## Security and maintenance

`RENDER_EXTERNAL_URL` supplies the accepted HTTPS origin. For a custom domain, set `PUBLIC_ORIGIN=https://your-domain.example` and redeploy. Hosted cookies include Secure, HttpOnly and SameSite=Strict; data routes reject unexpected hosts and writes reject missing or foreign origins. `/health` returns only database health for internal probes.

Future migrations run locally using the Neon schema owner before manually deploying reviewed code. Do not add owner credentials to the web service. Do not expose the PostgreSQL password to frontend JavaScript. Dashboard access is for administrators; ordinary operators receive only the CMS URL and shared password.

## Verification

```sh
make app-test
node app/scripts/test-hosted.mjs
```

The hosted test creates and removes a disposable Docker PostgreSQL instance. It tests migrations as a non-superuser owner, repeat migration safety, restricted-only startup, HTTPS origin checks, Secure cookies, login, registration, editing, search, persistence and denied destructive operations. It never connects to the existing CMS database. Actual TLS and the deployed URL are checked after provisioning.

References: [Render Free](https://render.com/docs/free), [Render web services](https://render.com/docs/web-services), [Neon](https://neon.com/faster).
