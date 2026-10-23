-- Record when the visitor gave consent for an RFQ.
--
-- The RFQ form sent a hardcoded `consent: true` with no checkbox and no
-- link to the privacy policy, so the boolean recorded no actual agreement.
-- The timestamp makes the agreement auditable.
ALTER TABLE "rfqs" ADD COLUMN "consent_at" TIMESTAMP(3);
