CREATE SEQUENCE support_ticket_number AS bigint MINVALUE 1 NO CYCLE;
CREATE TABLE support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_reference text NOT NULL UNIQUE DEFAULT ('SF-SUP-'||lpad(nextval('support_ticket_number')::text,5,'0')),
 idempotency_key uuid NOT NULL UNIQUE,
 category text NOT NULL,
 subject text NOT NULL CHECK (length(subject) BETWEEN 3 AND 160),
 description text NOT NULL CHECK (length(description) BETWEEN 10 AND 5000),
 requester_name text NOT NULL CHECK (length(requester_name) BETWEEN 2 AND 150),
 contact_email text,
 contact_phone text,
 priority text NOT NULL CHECK (priority IN ('Normal','High','Urgent')),
 related_record_type text,
 related_reference text,
 source_portal text NOT NULL CHECK (source_portal IN ('Admin','Operations')),
 status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Resolved','Closed')),
 notification_status text NOT NULL DEFAULT 'pending' CHECK (notification_status IN ('pending','sent','failed')),
 notification_attempts integer NOT NULL DEFAULT 0,
 notification_claimed_at timestamptz,
 notification_next_attempt_at timestamptz,
 notification_sent_at timestamptz,
 submitted_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision integer NOT NULL DEFAULT 1,
 CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL),
 CHECK ((related_record_type IS NULL AND related_reference IS NULL) OR (related_record_type IS NOT NULL AND related_reference IS NOT NULL))
);
CREATE INDEX support_tickets_submitted ON support_tickets(submitted_at DESC);
CREATE INDEX support_tickets_status_priority ON support_tickets(status,priority,submitted_at DESC);
CREATE INDEX support_tickets_notification ON support_tickets(notification_status,notification_next_attempt_at) WHERE notification_status<>'sent';
CREATE TABLE support_ticket_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE RESTRICT,
 action text NOT NULL,
 previous_status text,
 new_status text,
 note text,
 actor text NOT NULL,
 source_portal text NOT NULL CHECK (source_portal IN ('Admin','Operations')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_ticket_events_ticket ON support_ticket_events(ticket_id,created_at DESC);
CREATE INDEX milk_quality_checks_inspected_on ON milk_quality_checks(inspected_on);
CREATE INDEX milk_processing_batches_processed_on ON milk_processing_batches(processed_on);
CREATE INDEX milk_distributions_distributed_on_status ON milk_distributions(distributed_on,status,recipient_type);
REVOKE ALL ON support_tickets,support_ticket_events FROM PUBLIC;
GRANT SELECT,INSERT ON support_tickets,support_ticket_events TO satima_app;
GRANT UPDATE (status,notification_status,notification_attempts,notification_claimed_at,notification_next_attempt_at,notification_sent_at,updated_at,revision) ON support_tickets TO satima_app;
GRANT USAGE ON SEQUENCE support_ticket_number,support_ticket_events_id_seq TO satima_app;
