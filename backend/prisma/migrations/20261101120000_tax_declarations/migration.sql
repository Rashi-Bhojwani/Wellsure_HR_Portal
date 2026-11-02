-- Stage 7 (P7-2): windows, declarations, proofs and the directors' decisions on them. Append-only; a proof is never verified by the person it belongs to; only a Super Admin sets a window or decides a proof.
CREATE TYPE "TaxRegime" AS ENUM ('NEW', 'OLD');
CREATE TYPE "TaxWindowKind" AS ENUM ('DECLARATION', 'PROOF');
CREATE TYPE "TaxProofDecisionKind" AS ENUM ('ACCEPTED', 'REJECTED');

CREATE TABLE "tax_windows" (
    "id" TEXT NOT NULL,
    "financial_year" TEXT NOT NULL,
    "kind" "TaxWindowKind" NOT NULL,
    "opens_on" DATE NOT NULL,
    "closes_on" DATE NOT NULL,
    "set_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tax_windows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_windows_dates_check" CHECK ("closes_on" >= "opens_on")
);
CREATE INDEX "tax_windows_financial_year_kind_created_at_idx" ON "tax_windows"("financial_year", "kind", "created_at");

CREATE TABLE "tax_declarations" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "financial_year" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tax_declarations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tax_declarations_employee_id_financial_year_version_key" ON "tax_declarations"("employee_id", "financial_year", "version");

CREATE TABLE "tax_declaration_lines" (
    "id" TEXT NOT NULL,
    "declaration_id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    CONSTRAINT "tax_declaration_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_declaration_lines_amount_check" CHECK ("amount" >= 0)
);
CREATE UNIQUE INDEX "tax_declaration_lines_declaration_id_section_key" ON "tax_declaration_lines"("declaration_id", "section");
ALTER TABLE "tax_declaration_lines" ADD CONSTRAINT "tax_declaration_lines_declaration_id_fkey" FOREIGN KEY ("declaration_id") REFERENCES "tax_declarations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "tax_proofs" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "financial_year" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tax_proofs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tax_proofs_employee_id_financial_year_idx" ON "tax_proofs"("employee_id", "financial_year");

CREATE TABLE "tax_proof_decisions" (
    "id" TEXT NOT NULL,
    "proof_id" TEXT NOT NULL,
    "decision" "TaxProofDecisionKind" NOT NULL,
    "amount_verified" DECIMAL(20,6),
    "reason" TEXT NOT NULL,
    "decided_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tax_proof_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_proof_decisions_amount_check" CHECK (("decision" = 'ACCEPTED' AND "amount_verified" IS NOT NULL AND "amount_verified" >= 0) OR ("decision" = 'REJECTED' AND "amount_verified" IS NULL)),
    CONSTRAINT "tax_proof_decisions_reason_check" CHECK ("decision" = 'ACCEPTED' OR length(btrim("reason")) >= 3)
);
CREATE INDEX "tax_proof_decisions_proof_id_created_at_idx" ON "tax_proof_decisions"("proof_id", "created_at");
ALTER TABLE "tax_proof_decisions" ADD CONSTRAINT "tax_proof_decisions_proof_id_fkey" FOREIGN KEY ("proof_id") REFERENCES "tax_proofs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only, with the test purge as the one way out (as for every other ledger).
CREATE OR REPLACE FUNCTION tax_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'TAX_APPEND_ONLY: a tax window, declaration, proof or decision is never changed or deleted; a later entry replaces it';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tax_windows_append_only BEFORE UPDATE OR DELETE ON "tax_windows" FOR EACH ROW EXECUTE FUNCTION tax_append_only();
CREATE TRIGGER tax_declarations_append_only BEFORE UPDATE OR DELETE ON "tax_declarations" FOR EACH ROW EXECUTE FUNCTION tax_append_only();
CREATE TRIGGER tax_declaration_lines_append_only BEFORE UPDATE OR DELETE ON "tax_declaration_lines" FOR EACH ROW EXECUTE FUNCTION tax_append_only();
CREATE TRIGGER tax_proofs_append_only BEFORE UPDATE OR DELETE ON "tax_proofs" FOR EACH ROW EXECUTE FUNCTION tax_append_only();
CREATE TRIGGER tax_proof_decisions_append_only BEFORE UPDATE OR DELETE ON "tax_proof_decisions" FOR EACH ROW EXECUTE FUNCTION tax_append_only();

-- Only a Super Admin sets a window.
CREATE OR REPLACE FUNCTION tax_windows_directors_only() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."set_by_user_id" AND r."code" = 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'TAX_DIRECTORS_ONLY: only a Super Admin sets a declaration or proof window';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tax_windows_directors_only BEFORE INSERT ON "tax_windows" FOR EACH ROW EXECUTE FUNCTION tax_windows_directors_only();

-- Only a Super Admin decides a proof, and never one that belongs to themselves.
CREATE OR REPLACE FUNCTION tax_proof_decisions_guard() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."decided_by_user_id" AND r."code" = 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'TAX_DIRECTORS_ONLY: only a Super Admin decides a proof';
  END IF;
  IF EXISTS (SELECT 1 FROM "tax_proofs" p JOIN "users" u ON u."employee_id" = p."employee_id" WHERE p."id" = NEW."proof_id" AND u."id" = NEW."decided_by_user_id") THEN
    RAISE EXCEPTION 'TAX_NOT_YOUR_OWN: nobody verifies their own proof';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tax_proof_decisions_guard BEFORE INSERT ON "tax_proof_decisions" FOR EACH ROW EXECUTE FUNCTION tax_proof_decisions_guard();
