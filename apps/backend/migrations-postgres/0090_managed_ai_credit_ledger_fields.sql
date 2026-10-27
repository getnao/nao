ALTER TABLE "credit_grant_policy" ADD COLUMN "max_grants_per_org" integer;--> statement-breakpoint
UPDATE "credit_grant_policy"
SET "max_grants_per_org" = CASE "grant_type"
	WHEN 'organization_setup' THEN 1
	WHEN 'user_join' THEN 100
END
WHERE "grant_type" IN ('organization_setup', 'user_join');--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "grant_type" text;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "purchase_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_grant_type_credit_grant_policy_grant_type_fk" FOREIGN KEY ("grant_type") REFERENCES "public"."credit_grant_policy"("grant_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_walletId_grantType_idx" ON "credit_ledger" USING btree ("wallet_id","grant_type");--> statement-breakpoint
CREATE INDEX "credit_ledger_purchasePaymentIntentId_idx" ON "credit_ledger" USING btree ("purchase_payment_intent_id");