import type { StatusTone } from '@/components/monitoring/status-label';

export const DAILY_COST_LIMIT_USD = 2;

const TODAY = new Date('2026-11-27T10:12:00Z');

function daysAgo(days: number, hour = 9, minute = 0): string {
	const date = new Date(TODAY);
	date.setUTCDate(date.getUTCDate() - days);
	date.setUTCHours(hour, minute, 0, 0);
	return date.toISOString();
}

function dayBucket(days: number): string {
	return daysAgo(days).slice(0, 10);
}

export function asQuery<T>(data: T) {
	return { data, isPending: false, isError: false, error: null, refetch: () => undefined };
}

export const formatUsd = (value: number) =>
	value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(value >= 100 ? 0 : 2)}`;

export const formatTokens = (value: number) =>
	value >= 1_000_000
		? `${(value / 1_000_000).toFixed(1)}M`
		: value >= 1000
			? `${Math.round(value / 1000)}k`
			: `${value}`;

/** Story editor view: one story. */
export const STORY_COST_PER_DAY = [
	0.62, 0.71, 0.58, 0.66, 0.74, 0.69, 0.63, 0.71, 0.66, 0.68, 1.92, 2.41, 3.08, 4.12,
].map((cost, index, all) => ({
	bucket: dayBucket(all.length - 1 - index),
	liveText: +(cost * 0.86).toFixed(2),
	queries: +(cost * 0.14).toFixed(2),
}));

export const STORY_REFRESHES_PER_DAY = [24, 24, 23, 24, 24, 24, 24, 24, 22, 24, 61, 96, 96, 41].map(
	(count, index, all) => ({
		bucket: dayBucket(all.length - 1 - index),
		completed: count - (index === 11 ? 3 : index === 13 ? 1 : 0),
		failed: index === 11 ? 3 : index === 13 ? 1 : 0,
	}),
);

export interface MockRefreshRun {
	id: string;
	status: 'completed' | 'failed' | 'running';
	startedAt: string;
	trigger: 'Schedule' | 'Manual' | 'Viewer';
	actor?: string;
	durationMs: number;
	queries: number;
	tokens: number;
	costUsd: number;
	error?: string;
}

export const STORY_REFRESH_RUNS: MockRefreshRun[] = [
	{
		id: 'r1',
		status: 'running',
		startedAt: daysAgo(0, 10, 0),
		trigger: 'Schedule',
		durationMs: 0,
		queries: 4,
		tokens: 0,
		costUsd: 0,
	},
	{
		id: 'r2',
		status: 'completed',
		startedAt: daysAgo(0, 9, 45),
		trigger: 'Schedule',
		durationMs: 18_400,
		queries: 4,
		tokens: 38_210,
		costUsd: 0.043,
	},
	{
		id: 'r3',
		status: 'failed',
		startedAt: daysAgo(0, 9, 30),
		trigger: 'Schedule',
		durationMs: 31_200,
		queries: 2,
		tokens: 0,
		costUsd: 0,
		error: 'Query "orders_by_month" failed: Snowflake warehouse COMPUTE_WH is suspended (code 000606).',
	},
	{
		id: 'r4',
		status: 'completed',
		startedAt: daysAgo(0, 9, 15),
		trigger: 'Manual',
		actor: 'Léa Martin',
		durationMs: 21_900,
		queries: 4,
		tokens: 41_870,
		costUsd: 0.047,
	},
	{
		id: 'r5',
		status: 'completed',
		startedAt: daysAgo(0, 9, 0),
		trigger: 'Schedule',
		durationMs: 17_300,
		queries: 4,
		tokens: 37_950,
		costUsd: 0.042,
	},
	{
		id: 'r6',
		status: 'completed',
		startedAt: daysAgo(0, 8, 45),
		trigger: 'Viewer',
		actor: 'Tom Becker',
		durationMs: 16_800,
		queries: 4,
		tokens: 38_020,
		costUsd: 0.043,
	},
	{
		id: 'r7',
		status: 'completed',
		startedAt: daysAgo(0, 8, 30),
		trigger: 'Schedule',
		durationMs: 19_100,
		queries: 4,
		tokens: 39_400,
		costUsd: 0.044,
	},
	{
		id: 'r8',
		status: 'failed',
		startedAt: daysAgo(2, 14, 15),
		trigger: 'Schedule',
		durationMs: 60_000,
		queries: 4,
		tokens: 12_400,
		costUsd: 0.014,
		error: 'Live text rewrite timed out after 60s (model claude-sonnet-5-5).',
	},
];

export interface MockDelivery {
	id: string;
	status: 'completed' | 'failed' | 'partial';
	sentAt: string;
	recipients: number;
	channels: { name: 'Email' | 'Slack' | 'Teams'; ok: boolean; detail: string }[];
	error?: string;
}

export const STORY_DELIVERIES: MockDelivery[] = [
	{
		id: 'd1',
		status: 'partial',
		sentAt: daysAgo(0, 8, 0),
		recipients: 14,
		channels: [
			{ name: 'Email', ok: true, detail: '12 of 12 sent' },
			{ name: 'Slack', ok: false, detail: '#sales-weekly' },
		],
		error: 'Slack: channel_not_found — nao was removed from #sales-weekly.',
	},
	{
		id: 'd2',
		status: 'completed',
		sentAt: daysAgo(7, 8, 0),
		recipients: 14,
		channels: [
			{ name: 'Email', ok: true, detail: '12 of 12 sent' },
			{ name: 'Slack', ok: true, detail: '#sales-weekly' },
		],
	},
	{
		id: 'd3',
		status: 'completed',
		sentAt: daysAgo(14, 8, 0),
		recipients: 13,
		channels: [
			{ name: 'Email', ok: true, detail: '11 of 11 sent' },
			{ name: 'Slack', ok: true, detail: '#sales-weekly' },
		],
	},
	{
		id: 'd4',
		status: 'failed',
		sentAt: daysAgo(21, 8, 0),
		recipients: 13,
		channels: [
			{ name: 'Email', ok: false, detail: '0 of 11 sent' },
			{ name: 'Slack', ok: false, detail: '#sales-weekly' },
		],
		error: 'The refresh before delivery failed, so nothing was sent: Snowflake warehouse COMPUTE_WH is suspended.',
	},
];

export const STORY_EVENTS = [
	{ at: daysAgo(3, 16, 2), text: 'Léa Martin changed the refresh schedule from every hour to every 15 minutes.' },
];

/** Admin view: every story of the project. */
export const PROJECT_VIEWS_PER_DAY = [
	[310, 64, 22, 18],
	[342, 71, 25, 20],
	[120, 12, 9, 4],
	[98, 8, 6, 3],
	[388, 92, 31, 26],
	[402, 84, 28, 24],
	[371, 77, 30, 22],
].map(([app, delivery, shared, embed], index, all) => ({
	bucket: dayBucket(all.length - 1 - index),
	app,
	delivery,
	shared,
	embed,
}));

export const READING_SURFACES = [
	{ key: 'app', label: 'In the app', value: 2131 },
	{ key: 'email', label: 'Email delivery', value: 286 },
	{ key: 'slack', label: 'Slack delivery', value: 112 },
	{ key: 'shared', label: 'Shared links', value: 151 },
	{ key: 'embed', label: 'Embeds', value: 117 },
];

export const STORY_FUNNEL = [
	{ key: 'created', label: 'Created', value: 37 },
	{ key: 'viewed', label: 'Viewed by others', value: 24 },
	{ key: 'shared', label: 'Shared', value: 21 },
	{ key: 'live', label: 'Made live', value: 14 },
	{ key: 'delivery', label: 'Scheduled delivery', value: 9 },
];

export interface MockStoryRow {
	id: string;
	title: string;
	owner: string;
	views: number;
	viewers: number;
	medianReadMs: number;
	schedule: string;
	refreshes: number;
	failureRate: number;
	costPerDay: number;
	costInRange: number;
	limit: number;
	lastStatus: StatusTone;
	lastViewed: string;
	dailyCost: number[];
}

export const PROJECT_STORIES: MockStoryRow[] = [
	{
		id: 's1',
		title: 'Jaffle Shop orders: volume, fulfillment and value',
		owner: 'Léa Martin',
		views: 412,
		viewers: 31,
		medianReadMs: 94_000,
		schedule: 'Every 15 min',
		refreshes: 412,
		failureRate: 0.0097,
		costPerDay: 3.2,
		costInRange: 22.4,
		limit: 2,
		lastStatus: 'success',
		lastViewed: '12 min ago',
		dailyCost: [0.62, 0.71, 0.58, 0.66, 0.74, 0.69, 0.63, 0.71, 0.66, 0.68, 1.92, 2.41, 3.08, 4.12],
	},
	{
		id: 's2',
		title: 'Weekly revenue by region',
		owner: 'Tom Becker',
		views: 688,
		viewers: 54,
		medianReadMs: 71_000,
		schedule: 'Every hour',
		refreshes: 168,
		failureRate: 0,
		costPerDay: 1.41,
		costInRange: 9.87,
		limit: 2,
		lastStatus: 'success',
		lastViewed: '1 h ago',
		dailyCost: [1.2, 1.49, 1.37, 1.24, 1.54, 1.41, 1.28, 1.58, 1.45, 1.33, 1.2, 1.49, 1.37, 1.24],
	},
	{
		id: 's3',
		title: 'Board pack — November',
		owner: 'Christophe Blefari',
		views: 96,
		viewers: 9,
		medianReadMs: 212_000,
		schedule: 'Every day 7:00',
		refreshes: 7,
		failureRate: 0,
		costPerDay: 1.18,
		costInRange: 8.26,
		limit: 5,
		lastStatus: 'success',
		lastViewed: 'yesterday',
		dailyCost: [1.0, 1.25, 1.14, 1.04, 1.29, 1.18, 1.07, 1.32, 1.22, 1.11, 1.0, 1.25, 1.14, 1.04],
	},
	{
		id: 's4',
		title: 'Churn early warning',
		owner: 'Amira Haddad',
		views: 251,
		viewers: 18,
		medianReadMs: 48_000,
		schedule: 'Every 30 min',
		refreshes: 336,
		failureRate: 0.12,
		costPerDay: 0.92,
		costInRange: 6.44,
		limit: 2,
		lastStatus: 'error',
		lastViewed: '3 h ago',
		dailyCost: [0.78, 0.98, 0.89, 0.81, 1.0, 0.92, 0.84, 1.03, 0.95, 0.86, 0.78, 0.98, 0.89, 0.81],
	},
	{
		id: 's5',
		title: 'Marketing funnel (custom)',
		owner: 'Jonas Weber',
		views: 534,
		viewers: 47,
		medianReadMs: 63_000,
		schedule: 'Every hour',
		refreshes: 168,
		failureRate: 0.018,
		costPerDay: 0.44,
		costInRange: 3.08,
		limit: 2,
		lastStatus: 'success',
		lastViewed: '40 min ago',
		dailyCost: [0.37, 0.47, 0.43, 0.39, 0.48, 0.44, 0.4, 0.49, 0.45, 0.41, 0.37, 0.47, 0.43, 0.39],
	},
	{
		id: 's6',
		title: 'Support SLA tracker',
		owner: 'Léa Martin',
		views: 377,
		viewers: 22,
		medianReadMs: 39_000,
		schedule: 'Manual',
		refreshes: 12,
		failureRate: 0,
		costPerDay: 0.03,
		costInRange: 0.21,
		limit: 2,
		lastStatus: 'success',
		lastViewed: '2 h ago',
		dailyCost: [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03],
	},
	{
		id: 's7',
		title: 'Q3 pipeline snapshot',
		owner: 'Amira Haddad',
		views: 0,
		viewers: 0,
		medianReadMs: 0,
		schedule: 'Every 15 min',
		refreshes: 672,
		failureRate: 0,
		costPerDay: 0.94,
		costInRange: 6.58,
		limit: 2,
		lastStatus: 'success',
		lastViewed: '41 days ago',
		dailyCost: [0.91, 0.95, 0.93, 0.96, 0.92, 0.94, 0.95, 0.93, 0.94, 0.96, 0.92, 0.95, 0.94, 0.93],
	},
	{
		id: 's8',
		title: 'Churn model test (old)',
		owner: 'Jonas Weber',
		views: 0,
		viewers: 0,
		medianReadMs: 0,
		schedule: 'Every hour',
		refreshes: 168,
		failureRate: 0.31,
		costPerDay: 0.39,
		costInRange: 2.73,
		limit: 2,
		lastStatus: 'error',
		lastViewed: '63 days ago',
		dailyCost: [0.4, 0.38, 0.41, 0.37, 0.39, 0.4, 0.38, 0.39, 0.41, 0.37, 0.4, 0.39, 0.38, 0.39],
	},
];

export interface MockCostlyRefresh {
	id: string;
	story: string;
	owner: string;
	startedAt: string;
	trigger: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	timesMedian: number;
}

export const COSTLIEST_REFRESHES: MockCostlyRefresh[] = [
	{
		id: 'c1',
		story: 'Board pack — November',
		owner: 'Christophe Blefari',
		startedAt: daysAgo(1, 7, 0),
		trigger: 'Schedule',
		model: 'claude-opus-5-5',
		inputTokens: 182_400,
		outputTokens: 9_800,
		costUsd: 1.21,
		timesMedian: 1.1,
	},
	{
		id: 'c2',
		story: 'Churn early warning',
		owner: 'Amira Haddad',
		startedAt: daysAgo(2, 11, 30),
		trigger: 'Schedule',
		model: 'claude-sonnet-5-5',
		inputTokens: 241_900,
		outputTokens: 6_100,
		costUsd: 0.82,
		timesMedian: 41,
	},
	{
		id: 'c3',
		story: 'Board pack — November',
		owner: 'Christophe Blefari',
		startedAt: daysAgo(4, 7, 0),
		trigger: 'Manual',
		model: 'claude-opus-5-5',
		inputTokens: 171_000,
		outputTokens: 8_700,
		costUsd: 1.12,
		timesMedian: 1,
	},
	{
		id: 'c4',
		story: 'Weekly revenue by region',
		owner: 'Tom Becker',
		startedAt: daysAgo(0, 9, 0),
		trigger: 'Schedule',
		model: 'claude-sonnet-5-5',
		inputTokens: 52_300,
		outputTokens: 2_900,
		costUsd: 0.2,
		timesMedian: 3.4,
	},
	{
		id: 'c5',
		story: 'Jaffle Shop orders: volume, fulfillment and value',
		owner: 'Léa Martin',
		startedAt: daysAgo(0, 9, 15),
		trigger: 'Manual',
		model: 'claude-sonnet-5-5',
		inputTokens: 39_800,
		outputTokens: 2_070,
		costUsd: 0.047,
		timesMedian: 1.1,
	},
].sort((left, right) => right.costUsd - left.costUsd);

export const PROJECT_FAILURES = [
	{
		id: 'f1',
		kind: 'Refresh',
		story: 'Churn early warning',
		owner: 'Amira Haddad',
		at: daysAgo(0, 9, 30),
		message: 'Query "accounts_at_risk" failed: column "mrr_eur" does not exist.',
	},
	{
		id: 'f2',
		kind: 'Delivery',
		story: 'Jaffle Shop orders: volume, fulfillment and value',
		owner: 'Léa Martin',
		at: daysAgo(0, 8, 0),
		message: 'Slack: channel_not_found — nao was removed from #sales-weekly.',
	},
	{
		id: 'f3',
		kind: 'Refresh',
		story: 'Jaffle Shop orders: volume, fulfillment and value',
		owner: 'Léa Martin',
		at: daysAgo(0, 9, 30),
		message: 'Snowflake warehouse COMPUTE_WH is suspended (code 000606).',
	},
];

export type GridStoryStatus = 'live' | 'not_live' | 'archived';

export interface GridStory {
	id: string;
	title: string;
	owner: string;
	status: GridStoryStatus;
	schedule: string;
	views: number;
	readers: number;
	lastReadDays: number | null;
	failureRate: number;
	costPerDay: number;
	limit: number;
	dailyCost: number[];
}

const GRID_OWNERS: [string, number][] = [
	['Léa Martin', 34],
	['Tom Becker', 27],
	['Amira Haddad', 24],
	['Jonas Weber', 21],
	['Christophe Blefari', 18],
	['Sofia Rossi', 16],
	['Malik Diallo', 14],
	['Hannah Schmidt', 12],
	['Lucas Moreau', 10],
	['Priya Nair', 9],
	['Elena Petrova', 8],
	['Oscar Lindqvist', 7],
	['Yuki Tanaka', 7],
	['Noah Dubois', 5],
];
const GRID_SUBJECTS = [
	'Revenue',
	'Churn',
	'Orders',
	'Pipeline',
	'Support SLA',
	'Marketing funnel',
	'Inventory',
	'NPS',
	'Cohort retention',
	'Board pack',
	'Pricing test',
	'Ad spend',
	'Fulfillment',
	'Hiring plan',
	'Cash runway',
];
const GRID_CUTS = [
	'by region',
	'weekly',
	'by product',
	'deep dive',
	'Q3',
	'Q4',
	'by channel',
	'exec summary',
	'by segment',
	'November',
	'tracker',
	'forecast',
];
const GRID_SCHEDULES = [
	'Every 15 min',
	'Every 30 min',
	'Every hour',
	'Every 6 hours',
	'Every day 7:00',
	'Weekdays 9:00',
];

/** 212 stories over 14 owners, a third of them live, so the grid has something to filter and group. */
export function buildGridStories(): GridStory[] {
	let seed = 42;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const stories: GridStory[] = [];
	for (const [owner, count] of GRID_OWNERS) {
		for (let index = 0; index < count; index++) {
			const roll = random();
			const status: GridStoryStatus = roll < 0.36 ? 'live' : roll < 0.9 ? 'not_live' : 'archived';
			const isLive = status === 'live';
			const schedule = isLive ? GRID_SCHEDULES[Math.floor(random() * GRID_SCHEDULES.length)] : '—';
			const isUnread = isLive && random() < 0.12;
			const views = status === 'archived' || isUnread ? 0 : Math.round(random() ** 2 * 700);
			const readers = Math.min(views, Math.round(views * (0.08 + random() * 0.12)));
			const frequency =
				{
					'Every 15 min': 96,
					'Every 30 min': 48,
					'Every hour': 24,
					'Every 6 hours': 4,
					'Every day 7:00': 1,
					'Weekdays 9:00': 0.7,
				}[schedule] ?? 0;
			const costPerDay = isLive ? +(frequency * (0.008 + random() * 0.035)).toFixed(2) : 0;
			const limit = random() < 0.1 ? 5 : 2;
			stories.push({
				id: `g${stories.length}`,
				title: `${GRID_SUBJECTS[Math.floor(random() * GRID_SUBJECTS.length)]} ${GRID_CUTS[Math.floor(random() * GRID_CUTS.length)]}`,
				owner,
				status,
				schedule,
				views,
				readers,
				lastReadDays:
					views === 0
						? status === 'archived'
							? null
							: 20 + Math.floor(random() * 60)
						: Math.floor(random() ** 3 * 20),
				failureRate:
					isLive && random() < 0.15
						? +(0.05 + random() * 0.3).toFixed(3)
						: isLive
							? +(random() * 0.02).toFixed(3)
							: 0,
				costPerDay,
				limit,
				dailyCost: Array.from({ length: 14 }, () => +(costPerDay * (0.75 + random() * 0.5)).toFixed(2)),
			});
		}
	}
	return stories;
}
