-- Authentication survives application restarts. Only token hashes are stored.
CREATE TABLE auth_sessions (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 role text NOT NULL CHECK (role IN ('administrator','viewer','registration_viewer')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

-- Incomplete forms are tied to a private, persistent device cookie.
CREATE TABLE form_drafts (
 device_hash text NOT NULL CHECK (device_hash ~ '^[a-f0-9]{64}$'),
 role text NOT NULL CHECK (role IN ('administrator','viewer','registration_viewer')),
 kind text NOT NULL CHECK (kind IN ('farmer-registration','milk-collection','quality-control','processing-batch','milk-distribution')),
 content jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(device_hash,role,kind)
);
CREATE INDEX form_drafts_expiry ON form_drafts(expires_at);

REVOKE ALL ON auth_sessions,form_drafts FROM PUBLIC;
GRANT SELECT,INSERT,DELETE ON auth_sessions TO satima_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON form_drafts TO satima_app;
