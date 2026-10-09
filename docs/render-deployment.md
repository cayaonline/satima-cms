# Shared online CMS on Render

This deployment runs the existing interface and database schema on one Node web service and one persistent PostgreSQL 18 database. No farmer records, PDFs, local passwords or backups are in GitHub. A new deployment initially has an empty directory.

[Prepare this repository on Render](https://render.com/deploy?repo=https://github.com/cayaonline/satima-cms)

## First deployment

1. Sign in to Render with GitHub. Authorize Render and install its GitHub app for **only `cayaonline/satima-cms`** when repository access is requested. The repository stays private.
2. Open the deployment link above. Review the two resources in `render.yaml`: one `0.5c-512mb` web service and one `0.1c-256mb` PostgreSQL database with 1 GB storage, both in Frankfurt. These are paid resources. Review Render's displayed recurring cost before confirming creation. No hosting has been purchased by preparing these files.
3. Approve creation only after reviewing the cost. The pre-deploy command applies the existing migrations, checks their hashes, and configures the restricted `satima_app` database login. No seeds run automatically.
4. Wait for the web service to report **Live**. Open the HTTPS URL shown on that service (Render assigns the actual hostname). This URL is the link to share with trusted operators.
5. In the web service's **Environment** page, reveal/copy `CMS_PASSWORD` and use it to sign in. Render generates this password; the Mac's local password is not the cloud password. Send it privately to trusted operators.
6. Verify `/health`, sign-in, and farmer registration before migrating real records. Follow the transfer checklist below before switching daily work to the shared online copy.

The blueprint disables automatic deploys. Deploy future reviewed commits from Render's Manual Deploy control. Keep one web instance: sessions are stored in memory and expire after eight hours or restart. A redeploy signs operators out. All operators still share the same password and audit actor; this update does not introduce individual staff accounts.

## Move the existing database privately

This is a separate, one-time cutover. Do not upload a database dump to GitHub or paste its contents into logs. Arrange the transfer only after the account owner approves storing the farmer registrations (including identity, contact, next-of-kin and M-Pesa information) in their Render database in Frankfurt.

- Stop edits during transfer and run `make backup` on the Mac. Keep the original local database and the new private backup.
- Confirm the cloud database is a new, unused deployment. If it already contains new records, stop and reconcile them before restoring; do not overwrite them.
- For a supervised restore from the Mac, temporarily allow only the Mac's current public IP `/32` in the Render database's external access settings. Use the external database credentials and TLS with certificate verification. Do not open it to `0.0.0.0/0`.
- Using PostgreSQL 18 `pg_restore`, restore the private full dump into the unused cloud `satima_cms` database with `--clean --if-exists --no-owner --no-acl --single-transaction`. Supply the connection through private environment variables or a mode-600 password file, never command arguments or Git. This replaces the empty schema with the local schema, records, audit history and sequence state.
- Manually redeploy the web service. The pre-deploy script verifies the restored migration ledger, reapplies app grants and configures its cloud password. All web queries use `satima_app`, not the schema owner.
- Restore the database external IP list to empty. Web and database communicate over Render's internal connection.
- Verify 22 actual registrations and 5 separate demo records, customer-ID uniqueness, all related tables and audit counts against the local copy. Test search and one authorized edit before releasing the service to operators.
- Use the shared HTTPS URL for subsequent work. The Mac database remains a backup copy and will not synchronize automatically. Back up source PDFs separately; they are not stored in PostgreSQL.

## Configuration and verification

`RENDER_EXTERNAL_URL` supplies the accepted HTTPS origin automatically. A custom domain requires `PUBLIC_ORIGIN=https://your-domain.example` and a redeploy. Hosted cookies include Secure, HttpOnly and SameSite=Strict. Data routes reject unexpected hosts; writes reject missing or foreign origins. `/health` returns only database health and accepts internal health probes. Database external connections are disabled by default.

`ADMIN_DATABASE_URL` is used by migrations; startup derives a separate connection for `satima_app` and removes the admin URL from the running Node environment. Render workspace administrators can still access deployment secrets. Never share dashboard access with ordinary CMS operators.

Local verification:

```sh
make app-test
node app/scripts/test-hosted.mjs
```

The hosted test creates and removes its own disposable Docker PostgreSQL instance. It tests migrations as a non-superuser owner, repeat migration safety, login, HTTPS origin checks, Secure cookies, registration, edit, search, SQL persistence and denied destructive operations. It does not connect to the existing local CMS database. It simulates Render's proxy-facing HTTP requests; actual public TLS and Render account provisioning are verified after deployment.

References: [Render Blueprints](https://render.com/docs/blueprint-spec), [Deploy to Render](https://render.com/docs/deploy-to-render), [pricing](https://render.com/pricing), [PostgreSQL connections](https://render.com/docs/postgresql-creating-connecting).
