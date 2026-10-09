--
-- PostgreSQL database dump
--

\restrict y9blpros20iTm7kF7e4VzA6ReTr9xiJusk98JUfhWTJfIWdLTTBkPWHmSS53HAK

-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: farmer_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.farmer_status AS ENUM (
    'active',
    'inactive',
    'suspended',
    'pending_verification'
);


--
-- Name: audit_farmer_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_farmer_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE fid uuid;
BEGIN
 IF TG_TABLE_NAME = 'farmers' THEN fid := NEW.id; ELSE fid := NEW.farmer_id; END IF;
 INSERT INTO public.farmer_audit_events(farmer_id,table_name,operation,actor,before_record,after_record)
 VALUES(fid,TG_TABLE_NAME,TG_OP,coalesce(nullif(current_setting('app.actor',true),''),session_user),
 CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 RETURN NEW;
END $$;


--
-- Name: invalidate_changed_payment_verification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invalidate_changed_payment_verification() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.mpesa_registered_name IS DISTINCT FROM OLD.mpesa_registered_name
 OR NEW.mpesa_phone_number IS DISTINCT FROM OLD.mpesa_phone_number
 OR NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
  NEW.verified := false;
  NEW.verified_at := NULL;
 END IF;
 RETURN NEW;
END $$;


--
-- Name: next_farmer_customer_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_farmer_customer_id() RETURNS text
    LANGUAGE sql
    AS $$
 SELECT 'SF-F-' || CASE WHEN length(n::text) < 4 THEN lpad(n::text, 4, '0') ELSE n::text END
 FROM (SELECT nextval('farmer_customer_number') AS n) s;
$$;


--
-- Name: protect_consent_evidence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_consent_evidence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Consent evidence cannot be deleted'; END IF;
 IF (to_jsonb(NEW) - 'withdrawn_at' - 'updated_at') IS DISTINCT FROM
    (to_jsonb(OLD) - 'withdrawn_at' - 'updated_at') OR
    (OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at) THEN
   RAISE EXCEPTION 'Insert new consent evidence; only first withdrawal is allowed';
 END IF;
 RETURN NEW;
END $$;


--
-- Name: protect_farmer_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_farmer_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
  RAISE EXCEPTION 'Farmer identifiers are immutable';
 END IF;
 RETURN NEW;
END $$;


--
-- Name: reject_history_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_history_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 RAISE EXCEPTION 'Verification history is append-only; insert a new verification record';
END $$;


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 NEW.created_at := OLD.created_at;
 NEW.updated_at := clock_timestamp();
 RETURN NEW;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: farmer_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.farmer_audit_events (
    id bigint NOT NULL,
    farmer_id uuid NOT NULL,
    table_name text NOT NULL,
    operation text NOT NULL,
    actor text NOT NULL,
    before_record jsonb,
    after_record jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: farmer_audit_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.farmer_audit_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.farmer_audit_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: farmer_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.farmer_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    farmer_id uuid NOT NULL,
    consent_version text NOT NULL,
    information_accuracy_confirmed boolean,
    data_processing_consent boolean,
    communications_consent boolean,
    consent_given boolean,
    signed_name text,
    signature_method text,
    consent_date timestamp with time zone NOT NULL,
    withdrawn_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT confirmed_consent_requires_explicit_evidence CHECK (((consent_given IS DISTINCT FROM true) OR ((information_accuracy_confirmed IS TRUE) AND (data_processing_consent IS TRUE) AND (signed_name IS NOT NULL) AND (btrim(signed_name) <> ''::text) AND (signature_method IS NOT NULL)))),
    CONSTRAINT farmer_consents_check CHECK (((NOT consent_given) OR (information_accuracy_confirmed AND data_processing_consent AND (signed_name IS NOT NULL) AND (btrim(signed_name) <> ''::text) AND (signature_method IS NOT NULL)))),
    CONSTRAINT farmer_consents_check1 CHECK (((withdrawn_at IS NULL) OR (consent_given AND (withdrawn_at >= consent_date)))),
    CONSTRAINT farmer_consents_consent_version_check CHECK ((btrim(consent_version) <> ''::text)),
    CONSTRAINT farmer_consents_signature_method_check CHECK ((signature_method = ANY (ARRAY['signature'::text, 'thumbprint'::text, 'digital'::text]))),
    CONSTRAINT withdrawal_requires_confirmed_consent CHECK (((withdrawn_at IS NULL) OR (consent_given IS TRUE)))
);


--
-- Name: farmer_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.farmer_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    farmer_id uuid NOT NULL,
    contact_type text DEFAULT 'next_of_kin'::text NOT NULL,
    full_name text NOT NULL,
    phone_number text NOT NULL,
    relationship text NOT NULL,
    is_primary_alternative boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT farmer_contacts_contact_type_check CHECK ((contact_type = ANY (ARRAY['next_of_kin'::text, 'alternative'::text]))),
    CONSTRAINT farmer_contacts_full_name_check CHECK ((btrim(full_name) <> ''::text)),
    CONSTRAINT farmer_contacts_phone_number_check CHECK ((btrim(phone_number) <> ''::text)),
    CONSTRAINT farmer_contacts_relationship_check CHECK ((btrim(relationship) <> ''::text))
);


--
-- Name: farmer_customer_number; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.farmer_customer_number
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: farmer_data_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.farmer_data_issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    farmer_id uuid NOT NULL,
    field_name text NOT NULL,
    description text NOT NULL,
    severity text DEFAULT 'review'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    resolution_note text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT farmer_data_issues_check CHECK ((((status = 'open'::text) AND (resolved_at IS NULL)) OR ((status = 'resolved'::text) AND (resolved_at IS NOT NULL) AND (resolution_note IS NOT NULL) AND (btrim(resolution_note) <> ''::text)))),
    CONSTRAINT farmer_data_issues_description_check CHECK ((btrim(description) <> ''::text)),
    CONSTRAINT farmer_data_issues_field_name_check CHECK ((btrim(field_name) <> ''::text)),
    CONSTRAINT farmer_data_issues_severity_check CHECK ((severity = ANY (ARRAY['review'::text, 'high'::text]))),
    CONSTRAINT farmer_data_issues_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);


--
-- Name: farmer_payment_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.farmer_payment_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    farmer_id uuid NOT NULL,
    payment_method text DEFAULT 'mpesa'::text NOT NULL,
    mpesa_registered_name text NOT NULL,
    mpesa_phone_number text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT farmer_payment_profiles_check CHECK ((verified = (verified_at IS NOT NULL))),
    CONSTRAINT farmer_payment_profiles_mpesa_phone_number_check CHECK ((btrim(mpesa_phone_number) <> ''::text)),
    CONSTRAINT farmer_payment_profiles_mpesa_registered_name_check CHECK ((btrim(mpesa_registered_name) <> ''::text)),
    CONSTRAINT farmer_payment_profiles_payment_method_check CHECK ((payment_method = 'mpesa'::text))
);


--
-- Name: farmer_registration_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.farmer_registration_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    farmer_id uuid NOT NULL,
    document_name text NOT NULL,
    document_sha256 text NOT NULL,
    first_page integer NOT NULL,
    last_page integer NOT NULL,
    raw_transcription jsonb NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT farmer_registration_sources_check CHECK ((last_page >= first_page)),
    CONSTRAINT farmer_registration_sources_document_sha256_check CHECK ((document_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT farmer_registration_sources_first_page_check CHECK ((first_page > 0))
);


--
-- Name: farmer_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.farmer_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    farmer_id uuid NOT NULL,
    national_id_verified boolean,
    kra_pin_verified boolean,
    primary_phone_verified boolean,
    mpesa_number_verified boolean,
    mpesa_registered_name_confirmed boolean,
    registration_form_complete boolean,
    consent_obtained boolean,
    verified_by text NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT farmer_verifications_verified_by_check CHECK ((btrim(verified_by) <> ''::text))
);


--
-- Name: farmers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.farmers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id text DEFAULT public.next_farmer_customer_id() NOT NULL,
    registered_business_name text,
    full_name text NOT NULL,
    national_id text,
    primary_phone text NOT NULL,
    primary_phone_normalized text,
    physical_address text,
    village_area text,
    sub_location text,
    location text,
    sub_county text,
    county text,
    kra_pin text,
    registration_date date DEFAULT CURRENT_DATE NOT NULL,
    registered_by text NOT NULL,
    status public.farmer_status DEFAULT 'pending_verification'::public.farmer_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT farmers_customer_id_check CHECK ((customer_id ~ '^SF-F-[0-9]{4,}$'::text)),
    CONSTRAINT farmers_full_name_check CHECK ((btrim(full_name) <> ''::text)),
    CONSTRAINT farmers_kra_pin_check CHECK (((kra_pin IS NULL) OR ((kra_pin = upper(btrim(kra_pin))) AND (kra_pin <> ''::text)))),
    CONSTRAINT farmers_national_id_check CHECK (((national_id IS NULL) OR ((national_id = btrim(national_id)) AND (national_id <> ''::text)))),
    CONSTRAINT farmers_primary_phone_check CHECK ((btrim(primary_phone) <> ''::text)),
    CONSTRAINT farmers_primary_phone_normalized_check CHECK ((primary_phone_normalized ~ '^\+[1-9][0-9]{7,14}$'::text)),
    CONSTRAINT farmers_registered_by_check CHECK ((btrim(registered_by) <> ''::text))
);


--
-- Name: farmer_registration_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.farmer_registration_summary AS
 SELECT f.id AS farmer_id,
    f.customer_id,
    f.full_name AS farmer_name,
    f.registered_business_name AS business_name,
    f.primary_phone,
    f.county,
    c.full_name AS next_of_kin_name,
    c.phone_number AS next_of_kin_phone,
    p.mpesa_registered_name,
    p.mpesa_phone_number,
    f.registration_date,
    f.status,
        CASE
            WHEN (v.id IS NULL) THEN 'not_verified'::text
            WHEN (v.national_id_verified AND v.kra_pin_verified AND v.primary_phone_verified AND v.mpesa_number_verified AND v.mpesa_registered_name_confirmed AND v.registration_form_complete AND v.consent_obtained) THEN 'verified'::text
            ELSE 'incomplete'::text
        END AS latest_verification_status
   FROM (((public.farmers f
     LEFT JOIN LATERAL ( SELECT c_1.id,
            c_1.farmer_id,
            c_1.contact_type,
            c_1.full_name,
            c_1.phone_number,
            c_1.relationship,
            c_1.is_primary_alternative,
            c_1.created_at,
            c_1.updated_at
           FROM public.farmer_contacts c_1
          WHERE ((c_1.farmer_id = f.id) AND (c_1.contact_type = 'next_of_kin'::text))
          ORDER BY c_1.is_primary_alternative DESC, c_1.created_at DESC, c_1.id DESC
         LIMIT 1) c ON (true))
     LEFT JOIN public.farmer_payment_profiles p ON (((p.farmer_id = f.id) AND p.is_active)))
     LEFT JOIN LATERAL ( SELECT v_1.id,
            v_1.farmer_id,
            v_1.national_id_verified,
            v_1.kra_pin_verified,
            v_1.primary_phone_verified,
            v_1.mpesa_number_verified,
            v_1.mpesa_registered_name_confirmed,
            v_1.registration_form_complete,
            v_1.consent_obtained,
            v_1.verified_by,
            v_1.verified_at,
            v_1.notes,
            v_1.created_at,
            v_1.updated_at
           FROM public.farmer_verifications v_1
          WHERE (v_1.farmer_id = f.id)
          ORDER BY v_1.verified_at DESC, v_1.created_at DESC, v_1.id DESC
         LIMIT 1) v ON (true));


--
-- Name: VIEW farmer_registration_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.farmer_registration_summary IS 'Restricted PII view: latest verification is historical evidence, not current authorization or eligibility.';


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: farmer_audit_events farmer_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_audit_events
    ADD CONSTRAINT farmer_audit_events_pkey PRIMARY KEY (id);


--
-- Name: farmer_consents farmer_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_consents
    ADD CONSTRAINT farmer_consents_pkey PRIMARY KEY (id);


--
-- Name: farmer_contacts farmer_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_contacts
    ADD CONSTRAINT farmer_contacts_pkey PRIMARY KEY (id);


--
-- Name: farmer_data_issues farmer_data_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_data_issues
    ADD CONSTRAINT farmer_data_issues_pkey PRIMARY KEY (id);


--
-- Name: farmer_payment_profiles farmer_payment_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_payment_profiles
    ADD CONSTRAINT farmer_payment_profiles_pkey PRIMARY KEY (id);


--
-- Name: farmer_registration_sources farmer_registration_sources_document_sha256_first_page_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_registration_sources
    ADD CONSTRAINT farmer_registration_sources_document_sha256_first_page_key UNIQUE (document_sha256, first_page);


--
-- Name: farmer_registration_sources farmer_registration_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_registration_sources
    ADD CONSTRAINT farmer_registration_sources_pkey PRIMARY KEY (id);


--
-- Name: farmer_verifications farmer_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_verifications
    ADD CONSTRAINT farmer_verifications_pkey PRIMARY KEY (id);


--
-- Name: farmers farmers_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmers
    ADD CONSTRAINT farmers_customer_id_key UNIQUE (customer_id);


--
-- Name: farmers farmers_kra_pin_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmers
    ADD CONSTRAINT farmers_kra_pin_key UNIQUE (kra_pin);


--
-- Name: farmers farmers_national_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmers
    ADD CONSTRAINT farmers_national_id_key UNIQUE (national_id);


--
-- Name: farmers farmers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmers
    ADD CONSTRAINT farmers_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: audit_farmer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_farmer ON public.farmer_audit_events USING btree (farmer_id, created_at DESC);


--
-- Name: consents_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consents_latest ON public.farmer_consents USING btree (farmer_id, consent_date DESC, created_at DESC, id DESC);


--
-- Name: contacts_farmer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_farmer ON public.farmer_contacts USING btree (farmer_id);


--
-- Name: contacts_one_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contacts_one_primary ON public.farmer_contacts USING btree (farmer_id) WHERE is_primary_alternative;


--
-- Name: farmers_name_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX farmers_name_prefix ON public.farmers USING btree (lower(full_name) text_pattern_ops);


--
-- Name: farmers_phone_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX farmers_phone_normalized ON public.farmers USING btree (primary_phone_normalized) WHERE (primary_phone_normalized IS NOT NULL);


--
-- Name: farmers_primary_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX farmers_primary_phone ON public.farmers USING btree (primary_phone);


--
-- Name: farmers_registration_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX farmers_registration_date ON public.farmers USING btree (registration_date);


--
-- Name: issues_farmer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issues_farmer ON public.farmer_data_issues USING btree (farmer_id, status);


--
-- Name: payments_farmer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_farmer ON public.farmer_payment_profiles USING btree (farmer_id);


--
-- Name: payments_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payments_one_active ON public.farmer_payment_profiles USING btree (farmer_id) WHERE is_active;


--
-- Name: payments_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_phone ON public.farmer_payment_profiles USING btree (mpesa_phone_number);


--
-- Name: sources_farmer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sources_farmer ON public.farmer_registration_sources USING btree (farmer_id);


--
-- Name: verifications_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verifications_latest ON public.farmer_verifications USING btree (farmer_id, verified_at DESC, created_at DESC, id DESC);


--
-- Name: farmer_consents consents_evidence; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER consents_evidence BEFORE DELETE OR UPDATE ON public.farmer_consents FOR EACH ROW EXECUTE FUNCTION public.protect_consent_evidence();


--
-- Name: farmer_consents consents_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER consents_updated BEFORE UPDATE ON public.farmer_consents FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: farmer_contacts contacts_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contacts_updated BEFORE UPDATE ON public.farmer_contacts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: farmers farmers_identity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER farmers_identity BEFORE UPDATE ON public.farmers FOR EACH ROW EXECUTE FUNCTION public.protect_farmer_identity();


--
-- Name: farmers farmers_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER farmers_updated BEFORE UPDATE ON public.farmers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: farmer_data_issues issues_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER issues_updated BEFORE UPDATE ON public.farmer_data_issues FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: farmer_payment_profiles payments_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_updated BEFORE UPDATE ON public.farmer_payment_profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: farmer_payment_profiles payments_verification_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payments_verification_guard BEFORE UPDATE ON public.farmer_payment_profiles FOR EACH ROW EXECUTE FUNCTION public.invalidate_changed_payment_verification();


--
-- Name: farmer_consents record_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER record_audit AFTER INSERT OR UPDATE ON public.farmer_consents FOR EACH ROW EXECUTE FUNCTION public.audit_farmer_change();


--
-- Name: farmer_contacts record_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER record_audit AFTER INSERT OR UPDATE ON public.farmer_contacts FOR EACH ROW EXECUTE FUNCTION public.audit_farmer_change();


--
-- Name: farmer_data_issues record_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER record_audit AFTER INSERT OR UPDATE ON public.farmer_data_issues FOR EACH ROW EXECUTE FUNCTION public.audit_farmer_change();


--
-- Name: farmer_payment_profiles record_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER record_audit AFTER INSERT OR UPDATE ON public.farmer_payment_profiles FOR EACH ROW EXECUTE FUNCTION public.audit_farmer_change();


--
-- Name: farmer_registration_sources record_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER record_audit AFTER INSERT OR UPDATE ON public.farmer_registration_sources FOR EACH ROW EXECUTE FUNCTION public.audit_farmer_change();


--
-- Name: farmer_verifications record_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER record_audit AFTER INSERT OR UPDATE ON public.farmer_verifications FOR EACH ROW EXECUTE FUNCTION public.audit_farmer_change();


--
-- Name: farmers record_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER record_audit AFTER INSERT OR UPDATE ON public.farmers FOR EACH ROW EXECUTE FUNCTION public.audit_farmer_change();


--
-- Name: farmer_verifications verifications_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER verifications_immutable BEFORE DELETE OR UPDATE ON public.farmer_verifications FOR EACH ROW EXECUTE FUNCTION public.reject_history_change();


--
-- Name: farmer_audit_events farmer_audit_events_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_audit_events
    ADD CONSTRAINT farmer_audit_events_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id) ON DELETE RESTRICT;


--
-- Name: farmer_consents farmer_consents_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_consents
    ADD CONSTRAINT farmer_consents_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id) ON DELETE RESTRICT;


--
-- Name: farmer_contacts farmer_contacts_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_contacts
    ADD CONSTRAINT farmer_contacts_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id) ON DELETE RESTRICT;


--
-- Name: farmer_data_issues farmer_data_issues_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_data_issues
    ADD CONSTRAINT farmer_data_issues_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id) ON DELETE RESTRICT;


--
-- Name: farmer_payment_profiles farmer_payment_profiles_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_payment_profiles
    ADD CONSTRAINT farmer_payment_profiles_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id) ON DELETE RESTRICT;


--
-- Name: farmer_registration_sources farmer_registration_sources_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_registration_sources
    ADD CONSTRAINT farmer_registration_sources_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id) ON DELETE RESTRICT;


--
-- Name: farmer_verifications farmer_verifications_farmer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmer_verifications
    ADD CONSTRAINT farmer_verifications_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES public.farmers(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict y9blpros20iTm7kF7e4VzA6ReTr9xiJusk98JUfhWTJfIWdLTTBkPWHmSS53HAK
