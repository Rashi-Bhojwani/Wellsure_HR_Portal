-- PEEPS: retain the precise chosen scorecard source alongside its immutable snapshot.
ALTER TABLE recruitment_interviews ADD COLUMN scorecard_version_id TEXT;

-- Ciphertext may be maintained by the shared, plaintext-verifying rotation path.
-- Payload/author/time remain immutable; erasure is allowed only after expiry/request.
CREATE OR REPLACE FUNCTION peeps_recruitment_feedback_guard() RETURNS trigger AS $$ BEGIN
 IF current_setting('app.audit_purge',true)='test' AND EXISTS(SELECT 1 FROM dev_database_marker) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'answers_encrypted'-'recommendation_encrypted')=(to_jsonb(OLD)-'answers_encrypted'-'recommendation_encrypted') THEN
   IF current_setting('app.recruitment_reencrypt',true)='on' AND NEW.answers_encrypted IS NOT NULL AND NEW.recommendation_encrypted IS NOT NULL THEN RETURN NEW; END IF;
   IF NEW.answers_encrypted IS NULL AND NEW.recommendation_encrypted IS NULL AND EXISTS(SELECT 1 FROM recruitment_interviews i JOIN applications a ON a.id=i.application_id JOIN candidates c ON c.id=a.candidate_id WHERE i.id=OLD.interview_id AND (c.anonymized_at IS NOT NULL OR c.retention_until<=now())) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'RECRUITMENT_FEEDBACK_IMMUTABLE'; END; $$ LANGUAGE plpgsql;
