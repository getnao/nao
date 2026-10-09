export const AI_USAGE_CATEGORIES = [
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
export type AiUsageCategory = (typeof AI_USAGE_CATEGORIES)[number];

export const AI_USAGE_STATUSES = ['completed', 'aborted', 'failed'] as const;
export type AiUsageStatus = (typeof AI_USAGE_STATUSES)[number];

export const AI_USAGE_COST_SOURCES = ['provider_reported', 'price_book', 'estimated', 'unknown'] as const;
export type AiUsageCostSource = (typeof AI_USAGE_COST_SOURCES)[number];

export const CREDIT_LEDGER_ENTRY_TYPES = ['gift', 'purchase', 'referral', 'usage', 'refund', 'adjustment'] as const;
export type CreditLedgerEntryType = (typeof CREDIT_LEDGER_ENTRY_TYPES)[number];
