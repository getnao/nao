export const MANAGED_AI_USAGE_CATEGORIES = [
	'chat',
	'subagent',
	'compaction',
	'memory',
	'title',
	'automation',
	'story',
	'cron',
	'recommendation',
	'test',
] as const;
export type ManagedAiUsageCategory = (typeof MANAGED_AI_USAGE_CATEGORIES)[number];

export const MANAGED_AI_USAGE_STATUSES = ['completed', 'aborted', 'failed'] as const;
export type ManagedAiUsageStatus = (typeof MANAGED_AI_USAGE_STATUSES)[number];

export const MANAGED_AI_USAGE_COST_SOURCES = ['provider_reported', 'price_book', 'estimated', 'unknown'] as const;
export type ManagedAiUsageCostSource = (typeof MANAGED_AI_USAGE_COST_SOURCES)[number];

export const CREDIT_LEDGER_ENTRY_TYPES = [
	'gift',
	'purchase',
	'referral',
	'reservation',
	'usage',
	'refund',
	'adjustment',
] as const;
export type CreditLedgerEntryType = (typeof CREDIT_LEDGER_ENTRY_TYPES)[number];

export const CREDIT_GRANT_TYPES = ['organization_setup', 'user_join'] as const;
export type CreditGrantType = (typeof CREDIT_GRANT_TYPES)[number];
