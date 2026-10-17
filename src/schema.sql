CREATE TABLE IF NOT EXISTS organizations(id text PRIMARY KEY, name text NOT NULL, policy jsonb NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS entities(org text NOT NULL REFERENCES organizations(id), kind text NOT NULL, id text NOT NULL, version integer NOT NULL DEFAULT 1, data jsonb NOT NULL, created_at bigint NOT NULL, updated_at bigint NOT NULL, PRIMARY KEY(org,kind,id));
CREATE INDEX IF NOT EXISTS entities_kind ON entities(org,kind,updated_at DESC);
ALTER TABLE entities ADD COLUMN IF NOT EXISTS data_refs jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS entity_fragments(org text NOT NULL REFERENCES organizations(id), digest text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(org,digest));
CREATE OR REPLACE FUNCTION aidscaler_entity_data(scope text, document jsonb, refs jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE ref jsonb; piece jsonb; path text[];
BEGIN
  FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
    SELECT data INTO piece FROM entity_fragments WHERE org=scope AND digest=ref->>'digest';
    IF NOT FOUND THEN RAISE EXCEPTION 'Received document fragment unavailable' USING ERRCODE='22023'; END IF;
    SELECT array_agg(value ORDER BY ordinal) INTO path FROM jsonb_array_elements_text(ref->'path') WITH ORDINALITY AS item(value,ordinal);
    document := jsonb_set(document,path,piece,true);
  END LOOP;
  RETURN document;
END $$;
CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY, org text NOT NULL REFERENCES organizations(id), email text UNIQUE NOT NULL, name text NOT NULL, role text NOT NULL, password_hash text NOT NULL, active boolean NOT NULL DEFAULT true, created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires_at bigint NOT NULL, csrf text NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency(org text NOT NULL, key text NOT NULL, request_hash text NOT NULL, result jsonb, PRIMARY KEY(org,key));
CREATE TABLE IF NOT EXISTS audit(sequence bigserial PRIMARY KEY, org text NOT NULL, actor text NOT NULL, action text NOT NULL, entity text, detail jsonb NOT NULL, occurred_at bigint NOT NULL, previous_hash text NOT NULL, hash text NOT NULL);
CREATE INDEX IF NOT EXISTS audit_scope ON audit(org,sequence);
CREATE TABLE IF NOT EXISTS jobs(id text PRIMARY KEY, org text NOT NULL, kind text NOT NULL, payload jsonb NOT NULL, state text NOT NULL, attempts integer NOT NULL DEFAULT 0, due_at bigint NOT NULL, leased_until bigint, last_error text, result jsonb, created_at bigint NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(state,due_at);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_token text;
CREATE TABLE IF NOT EXISTS inbox(org text NOT NULL, message_id text NOT NULL, sender text NOT NULL, received_at bigint NOT NULL, PRIMARY KEY(org,message_id));
CREATE TABLE IF NOT EXISTS usage(id text PRIMARY KEY, org text NOT NULL, episode text NOT NULL, model text NOT NULL, request_hash text NOT NULL, state text NOT NULL, started_at bigint NOT NULL, wall_ms double precision, input_tokens bigint, output_tokens bigint, cost_usd double precision, reserved_usd double precision NOT NULL DEFAULT 0, provider_id text, pricing jsonb, result jsonb, error text);
CREATE TABLE IF NOT EXISTS finance(org text NOT NULL, id text NOT NULL, provider_event text UNIQUE, type text NOT NULL, amount_cents bigint NOT NULL, currency text NOT NULL, reference text, created_at bigint NOT NULL, PRIMARY KEY(org,id));
