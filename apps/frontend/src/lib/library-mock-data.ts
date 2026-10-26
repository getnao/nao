import type { LibraryItem, MockChatMessage, MockFilePreview, MockQuery, MockStory } from './library';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Prototype data standing in for the library API until stories are decoupled from their chat. */
export function buildMockLibraryItems(now = Date.now()): LibraryItem[] {
	return [...buildThisChatItems(now), ...buildMineItems(now), ...buildSharedItems(now)];
}

function buildThisChatItems(now: number): LibraryItem[] {
	return [
		{
			id: 'mock-story-q3-revenue',
			type: 'story',
			name: 'Q3 revenue review',
			section: 'this-chat',
			updatedAt: now - 12 * 60 * 1000,
			detail: '3 charts',
			content: { kind: 'mock-story', story: q3RevenueStory },
		},
		{
			id: 'mock-file-targets',
			type: 'file',
			name: 'sales_targets_2026.csv',
			section: 'this-chat',
			updatedAt: now - 40 * 60 * 1000,
			fileOrigin: 'uploaded',
			detail: '48 rows',
			content: { kind: 'mock-file', preview: salesTargetsPreview },
		},
		{
			id: 'mock-file-q3-deck',
			type: 'file',
			name: 'q3_revenue_review.pptx',
			section: 'this-chat',
			updatedAt: now - 8 * 60 * 1000,
			fileOrigin: 'generated',
			detail: '4 slides',
			content: { kind: 'mock-file', preview: q3DeckPreview },
		},
		{
			id: 'mock-file-region-export',
			type: 'file',
			name: 'revenue_by_region.xlsx',
			section: 'this-chat',
			updatedAt: now - 9 * 60 * 1000,
			fileOrigin: 'generated',
			detail: '1 sheet',
			content: { kind: 'mock-file', preview: { kind: 'table', ...tableFromQuery(revenueByRegionQuery) } },
		},
	];
}

function buildMineItems(now: number): LibraryItem[] {
	return [
		{
			id: 'mock-story-churn',
			type: 'story',
			name: 'Churn deep dive — enterprise',
			section: 'mine',
			updatedAt: now - 2 * DAY,
			originChatTitle: 'Why are enterprise accounts churning?',
			content: { kind: 'mock-story', story: churnStory },
		},
		{
			id: 'mock-story-weekly-kpis',
			type: 'story',
			name: 'Weekly KPI digest',
			section: 'mine',
			updatedAt: now - 5 * HOUR,
			originChatTitle: 'Monday KPIs',
			content: { kind: 'mock-story', story: weeklyKpiStory },
		},
		{
			id: 'mock-query-active-users',
			type: 'query',
			name: 'Weekly active users',
			section: 'mine',
			updatedAt: now - 3 * DAY,
			detail: '12 rows',
			originChatTitle: 'Monday KPIs',
			content: { kind: 'mock-query', query: weeklyActiveUsersQuery },
		},
		{
			id: 'mock-query-top-customers',
			type: 'query',
			name: 'Top 20 customers by ARR',
			section: 'mine',
			updatedAt: now - 9 * DAY,
			detail: '20 rows',
			originChatTitle: 'Account planning FY27',
			content: { kind: 'mock-query', query: topCustomersQuery },
		},
	];
}

function buildSharedItems(now: number): LibraryItem[] {
	return [
		{
			id: 'mock-story-marketing-attribution',
			type: 'story',
			name: 'Marketing attribution H2',
			section: 'shared',
			updatedAt: now - DAY,
			sharedBy: 'Marie Dupont',
			content: { kind: 'mock-story', story: attributionStory },
		},
		{
			id: 'mock-chat-pricing',
			type: 'chat',
			name: 'Pricing experiment results',
			section: 'shared',
			updatedAt: now - 4 * DAY,
			sharedBy: 'Thomas Martin',
			detail: '4 messages',
			content: { kind: 'mock-chat', messages: pricingChatMessages },
		},
		{
			id: 'mock-chat-forecast',
			type: 'chat',
			name: 'Pipeline forecast Q4',
			section: 'shared',
			updatedAt: now - 6 * DAY,
			sharedBy: 'Lea Bernard',
			detail: '2 messages',
			content: { kind: 'mock-chat', messages: forecastChatMessages },
		},
	];
}

const revenueByRegionQuery: MockQuery = {
	id: 'query_rev_region',
	dialect: 'snowflake',
	sql: `SELECT
  region,
  SUM(amount) AS revenue,
  COUNT(DISTINCT order_id) AS orders,
  SUM(amount) / COUNT(DISTINCT order_id) AS avg_order_value
FROM analytics.fct_orders
WHERE order_date BETWEEN '2026-07-01' AND '2026-09-30'
GROUP BY region
ORDER BY revenue DESC`,
	columns: ['region', 'revenue', 'orders', 'avg_order_value'],
	rows: [
		{ region: 'North America', revenue: 1824500, orders: 6120, avg_order_value: 298.1 },
		{ region: 'Europe', revenue: 1312800, orders: 4985, avg_order_value: 263.3 },
		{ region: 'APAC', revenue: 642300, orders: 2410, avg_order_value: 266.5 },
		{ region: 'LATAM', revenue: 218900, orders: 1032, avg_order_value: 212.1 },
	],
};

const weeklyActiveUsersQuery: MockQuery = {
	id: 'query_wau',
	dialect: 'snowflake',
	sql: `SELECT
  DATE_TRUNC('week', event_at) AS week,
  COUNT(DISTINCT user_id) AS weekly_active_users
FROM analytics.fct_events
WHERE event_at >= DATEADD('week', -12, CURRENT_DATE)
GROUP BY 1
ORDER BY 1`,
	columns: ['week', 'weekly_active_users'],
	rows: [
		{ week: '2026-08-03', weekly_active_users: 18240 },
		{ week: '2026-08-10', weekly_active_users: 18710 },
		{ week: '2026-08-17', weekly_active_users: 19105 },
		{ week: '2026-08-24', weekly_active_users: 18890 },
		{ week: '2026-08-31', weekly_active_users: 19620 },
		{ week: '2026-09-07', weekly_active_users: 20150 },
	],
};

const topCustomersQuery: MockQuery = {
	id: 'query_top_customers',
	dialect: 'snowflake',
	sql: `SELECT account_name, segment, arr
FROM analytics.dim_accounts
ORDER BY arr DESC
LIMIT 20`,
	columns: ['account_name', 'segment', 'arr'],
	rows: [
		{ account_name: 'Acme Corp', segment: 'Enterprise', arr: 480000 },
		{ account_name: 'Globex', segment: 'Enterprise', arr: 395000 },
		{ account_name: 'Initech', segment: 'Mid-market', arr: 212000 },
		{ account_name: 'Umbrella', segment: 'Enterprise', arr: 198500 },
	],
};

function tableFromQuery(query: MockQuery) {
	return { columns: query.columns, rows: query.rows };
}

const salesTargetsPreview: MockFilePreview = {
	kind: 'table',
	columns: ['region', 'quarter', 'target', 'owner'],
	rows: [
		{ region: 'North America', quarter: 'Q3', target: 1750000, owner: 'J. Smith' },
		{ region: 'Europe', quarter: 'Q3', target: 1400000, owner: 'M. Dupont' },
		{ region: 'APAC', quarter: 'Q3', target: 600000, owner: 'K. Tanaka' },
		{ region: 'LATAM', quarter: 'Q3', target: 250000, owner: 'L. Silva' },
		{ region: 'North America', quarter: 'Q4', target: 1950000, owner: 'J. Smith' },
		{ region: 'Europe', quarter: 'Q4', target: 1500000, owner: 'M. Dupont' },
	],
};

const q3DeckPreview: MockFilePreview = {
	kind: 'slides',
	slides: [
		{ title: 'Q3 revenue review', caption: 'Title slide' },
		{ title: 'Revenue up 14% QoQ', caption: 'KPI summary' },
		{ title: 'Revenue by region', caption: 'Bar chart' },
		{ title: 'Next steps', caption: 'Bullet list' },
	],
};

const q3RevenueStory: MockStory = {
	subtitle: 'Generated from this chat · Q3 2026',
	blocks: [
		{
			id: 'kpis',
			kind: 'kpis',
			kpis: [
				{ label: 'Revenue', value: '$4.0M', delta: '+14% QoQ', isPositive: true },
				{ label: 'Orders', value: '14,547', delta: '+9% QoQ', isPositive: true },
				{ label: 'Avg. order value', value: '$275', delta: '−2% QoQ', isPositive: false },
			],
		},
		{ id: 'h-region', kind: 'heading', text: 'Revenue by region' },
		{
			id: 'chart-region',
			kind: 'chart',
			title: 'Q3 revenue by region ($k)',
			chartType: 'bar',
			points: [
				{ label: 'North America', value: 1825 },
				{ label: 'Europe', value: 1313 },
				{ label: 'APAC', value: 642 },
				{ label: 'LATAM', value: 219 },
			],
		},
		{
			id: 'text-region',
			kind: 'text',
			text: 'North America and Europe make up 78% of Q3 revenue. Europe beat its target by 6%, while LATAM is 12% behind plan.',
		},
		{ id: 'h-trend', kind: 'heading', text: 'Monthly trend' },
		{
			id: 'chart-trend',
			kind: 'chart',
			title: 'Monthly revenue ($k)',
			chartType: 'line',
			points: [
				{ label: 'Apr', value: 1080 },
				{ label: 'May', value: 1150 },
				{ label: 'Jun', value: 1270 },
				{ label: 'Jul', value: 1240 },
				{ label: 'Aug', value: 1330 },
				{ label: 'Sep', value: 1430 },
			],
		},
	],
};

const churnStory: MockStory = {
	subtitle: 'Enterprise segment · last 12 months',
	blocks: [
		{
			id: 'kpis',
			kind: 'kpis',
			kpis: [
				{ label: 'Logo churn', value: '6.8%', delta: '+1.2 pts', isPositive: false },
				{ label: 'Net revenue retention', value: '112%', delta: '−3 pts', isPositive: false },
			],
		},
		{
			id: 'text',
			kind: 'text',
			text: 'Churned accounts had 40% fewer weekly active seats in the 90 days before renewal.',
		},
	],
};

const weeklyKpiStory: MockStory = {
	subtitle: 'Week 43 · auto-refreshed every Monday',
	blocks: [
		{
			id: 'kpis',
			kind: 'kpis',
			kpis: [
				{ label: 'WAU', value: '20,150', delta: '+2.7%', isPositive: true },
				{ label: 'New signups', value: '1,284', delta: '+5.1%', isPositive: true },
			],
		},
	],
};

const attributionStory: MockStory = {
	subtitle: 'Shared by Marie Dupont · Marketing',
	blocks: [
		{
			id: 'chart',
			kind: 'chart',
			title: 'Pipeline by first touch ($k)',
			chartType: 'bar',
			points: [
				{ label: 'Organic', value: 820 },
				{ label: 'Paid search', value: 610 },
				{ label: 'Events', value: 430 },
				{ label: 'Partners', value: 260 },
			],
		},
	],
};

const pricingChatMessages: MockChatMessage[] = [
	{ role: 'user', text: 'Did the new pricing page increase trial-to-paid conversion?' },
	{
		role: 'assistant',
		text: 'Yes. Trial-to-paid conversion went from 11.2% to 13.0% (+1.8 pts) over the 4 weeks of the experiment, with 95% confidence.',
	},
	{ role: 'user', text: 'Break it down by plan.' },
	{
		role: 'assistant',
		text: 'The lift comes almost entirely from the Team plan (+3.1 pts). Starter and Enterprise are flat.',
	},
];

const forecastChatMessages: MockChatMessage[] = [
	{ role: 'user', text: 'What is our weighted pipeline for Q4?' },
	{
		role: 'assistant',
		text: 'Weighted pipeline for Q4 is $5.2M across 184 open opportunities, 8% above the same point last year.',
	},
];
