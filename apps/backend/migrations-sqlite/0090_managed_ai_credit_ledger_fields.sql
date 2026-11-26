ALTER TABLE `credit_grant_policy` ADD `max_grants_per_org` integer;--> statement-breakpoint
UPDATE `credit_grant_policy`
SET `max_grants_per_org` = CASE `grant_type`
	WHEN 'organization_setup' THEN 1
	WHEN 'user_join' THEN 100
END
WHERE `grant_type` IN ('organization_setup', 'user_join');--> statement-breakpoint
ALTER TABLE `credit_ledger` ADD `grant_type` text REFERENCES credit_grant_policy(grant_type);--> statement-breakpoint
ALTER TABLE `credit_ledger` ADD `purchase_payment_intent_id` text;--> statement-breakpoint
CREATE INDEX `credit_ledger_walletId_grantType_idx` ON `credit_ledger` (`wallet_id`,`grant_type`);--> statement-breakpoint
CREATE INDEX `credit_ledger_purchasePaymentIntentId_idx` ON `credit_ledger` (`purchase_payment_intent_id`);