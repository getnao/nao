import path from 'node:path';

import { hashPassword } from 'better-auth/crypto';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';

const PASSWORD = 'password';
const EXAMPLE_PROJECT_PATH = path.resolve(import.meta.dirname, '../../../example');
const EXAMPLE_PROJECT_NAME = 'Jaffle Shop';

const USERS = [
	{ email: 'admin@company1.com', name: 'Admin Company1' },
	{ email: 'user@company1.com', name: 'User Company1' },
	{ email: 'admin@company2.com', name: 'Admin Company2' },
	{ email: 'user@freelancer.com', name: 'Freelancer' },
] as const;

const COMPANY1_ORG = { name: 'Company1 Labs', slug: 'company1-labs' };

async function seed() {
	console.log('Seeding cloud database...');

	const hashedPassword = await hashPassword(PASSWORD);
	const userIds: Record<string, string> = {};

	await db.transaction(async (tx) => {
		for (const u of USERS) {
			const existing = await tx.query.user.findFirst({ where: (t, { eq }) => eq(t.email, u.email) });
			if (existing) {
				userIds[u.email] = existing.id;
				continue;
			}

			const userId = crypto.randomUUID();
			userIds[u.email] = userId;

			await tx.insert(s.user).values({ id: userId, name: u.name, email: u.email, emailVerified: true }).execute();
			await tx
				.insert(s.account)
				.values({
					id: crypto.randomUUID(),
					accountId: userId,
					providerId: 'credential',
					userId,
					password: hashedPassword,
				})
				.execute();
		}

		const [org] = await upsertOrg(tx, COMPANY1_ORG);

		await ensureOrgMember(tx, org.id, userIds['admin@company1.com'], 'admin');
		await ensureOrgMember(tx, org.id, userIds['user@company1.com'], 'user');

		const [project] = await upsertProject(tx, {
			name: EXAMPLE_PROJECT_NAME,
			type: 'local' as const,
			path: EXAMPLE_PROJECT_PATH,
			orgId: org.id,
		});

		await ensureProjectMember(tx, project.id, userIds['admin@company1.com'], 'admin');
		await ensureProjectMember(tx, project.id, userIds['user@company1.com'], 'user');

		const freelancerId = userIds['user@freelancer.com'];
		await ensureOrgMember(tx, org.id, freelancerId, 'user');
		await ensureProjectMember(tx, project.id, freelancerId, 'user');

		const admin2Id = userIds['admin@company2.com'];
		const personalSlug = `org-${admin2Id.slice(0, 8)}`;
		const [personalOrg] = await upsertOrg(tx, { name: "Admin Company2's Organization", slug: personalSlug });
		await ensureOrgMember(tx, personalOrg.id, admin2Id, 'admin');
		await ensureOrgMember(tx, personalOrg.id, freelancerId, 'user');

		await seedConversations(tx, userIds['admin@company1.com'], project.id);
	});

	console.log('Done.');
	console.log('');
	for (const u of USERS) {
		console.log(`  ${u.email} / ${PASSWORD}`);
	}
	console.log('');
	console.log(`  Org: ${COMPANY1_ORG.name} (admin@company1.com + user@company1.com)`);
	console.log(`  Project: ${EXAMPLE_PROJECT_NAME} → ${EXAMPLE_PROJECT_PATH}`);
	console.log(`  Conversations: 3 (admin@company1.com)`);
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

async function seedConversations(tx: Tx, userId: string, projectId: string) {
	const existing = await tx.query.chat.findFirst({ where: (c, { eq }) => eq(c.userId, userId) });
	if (existing) {
		return;
	}

	await seedRevenueConversation(tx, userId, projectId);
	await seedCustomerConversation(tx, userId, projectId);
	await seedOrdersConversation(tx, userId, projectId);
}

/**
 * Conversation 1 — starred, with an execute_sql + display_chart in the chat
 * and a story containing an embedded chart.
 */
async function seedRevenueConversation(tx: Tx, userId: string, projectId: string) {
	const chatId = crypto.randomUUID();
	const sqlCallId = `call-${crypto.randomUUID()}`;
	const chartCallId = `call-${crypto.randomUUID()}`;
	const storyCallId = `call-${crypto.randomUUID()}`;
	const queryId = `query_${crypto.randomUUID().slice(0, 8)}` as const;

	await tx
		.insert(s.chat)
		.values({ id: chatId, userId, projectId, title: 'Monthly Revenue Analysis', isStarred: true })
		.execute();

	const revenueData = [
		{ month: '2024-07', revenue: 4250 },
		{ month: '2024-08', revenue: 4780 },
		{ month: '2024-09', revenue: 5120 },
		{ month: '2024-10', revenue: 5890 },
		{ month: '2024-11', revenue: 6340 },
		{ month: '2024-12', revenue: 7100 },
	];

	// User: asks about revenue
	await insertMessage(tx, chatId, 'user', [
		{ type: 'text', text: "What's our monthly revenue trend over the past 6 months?" },
	]);

	// Assistant: SQL query → chart → summary
	await insertMessage(tx, chatId, 'assistant', [
		{ type: 'text', text: "I'll analyze the monthly revenue from the orders data." },
		{
			type: 'tool-execute_sql',
			toolCallId: sqlCallId,
			toolName: 'execute_sql',
			toolState: 'output-available',
			toolInput: {
				sql_query: `SELECT strftime(order_date, '%Y-%m') AS month, SUM(amount) AS revenue FROM orders WHERE order_date >= '2024-07-01' GROUP BY month ORDER BY month`,
				name: 'Monthly revenue (last 6 months)',
			},
			toolOutput: {
				_version: '1',
				data: revenueData,
				row_count: 6,
				columns: ['month', 'revenue'],
				id: queryId,
				dialect: 'duckdb',
			},
		},
		{
			type: 'tool-display_chart',
			toolCallId: chartCallId,
			toolName: 'display_chart',
			toolState: 'output-available',
			toolInput: {
				query_id: queryId,
				chart_type: 'bar',
				x_axis_key: 'month',
				x_axis_type: 'category',
				series: [{ data_key: 'revenue', label: 'Revenue ($)', color: '#6366f1' }],
				title: 'Monthly Revenue Trend',
			},
			toolOutput: { _version: '1', success: true },
		},
		{
			type: 'text',
			text: 'Revenue has been growing steadily over the past 6 months, increasing from $4,250 in July to $7,100 in December — a 67% increase. The strongest month-over-month growth was between September and October (+15%).',
		},
	]);

	// User: asks for a report
	await insertMessage(tx, chatId, 'user', [{ type: 'text', text: 'Great, can you put this into a report?' }]);

	// Assistant: creates a story
	const storySlug = 'revenue-analysis';
	const storyCode = [
		'# Monthly Revenue Analysis',
		'',
		'## Revenue Trend',
		'',
		'Our monthly revenue has shown consistent growth over the past 6 months.',
		'',
		`<chart query_id="${queryId}" chart_type="bar" x_axis_key="month" series='[{"data_key":"revenue","label":"Revenue ($)","color":"#6366f1"}]' title="Monthly Revenue Trend" />`,
		'',
		'## Key Insights',
		'',
		'- **Total revenue** over the 6-month period: **$34,480**',
		'- **Average monthly revenue**: $5,747',
		'- **Growth rate**: 67% from July to December',
		'- **Strongest growth**: October saw a 15% month-over-month increase',
		'',
		'## Recommendations',
		'',
		'1. Investigate the drivers behind the October acceleration',
		'2. Set a target of $8,000/month for Q1 2025',
		'3. Monitor whether the growth trend sustains into the new year',
	].join('\n');

	await insertMessage(tx, chatId, 'assistant', [
		{
			type: 'tool-story',
			toolCallId: storyCallId,
			toolName: 'story',
			toolState: 'output-available',
			toolInput: { action: 'create', id: storySlug, title: 'Monthly Revenue Analysis', code: storyCode },
			toolOutput: {
				_version: '1',
				success: true,
				id: storySlug,
				version: 1,
				code: storyCode,
				title: 'Monthly Revenue Analysis',
			},
		},
		{
			type: 'text',
			text: "I've created a Revenue Analysis report with the chart and key insights. You can find it in your stories.",
		},
	]);

	// Story + version records
	const storyId = crypto.randomUUID();
	await tx
		.insert(s.story)
		.values({ id: storyId, chatId, slug: storySlug, title: 'Monthly Revenue Analysis' })
		.execute();
	await tx
		.insert(s.storyVersion)
		.values({ storyId, version: 1, code: storyCode, action: 'create', source: 'assistant' })
		.execute();
}

/** Conversation 2 — customer overview with SQL results. */
async function seedCustomerConversation(tx: Tx, userId: string, projectId: string) {
	const chatId = crypto.randomUUID();
	const sqlCallId = `call-${crypto.randomUUID()}`;
	const queryId = `query_${crypto.randomUUID().slice(0, 8)}` as const;

	await tx.insert(s.chat).values({ id: chatId, userId, projectId, title: 'Customer Overview' }).execute();

	await insertMessage(tx, chatId, 'user', [{ type: 'text', text: 'Give me an overview of our customer base.' }]);

	await insertMessage(tx, chatId, 'assistant', [
		{ type: 'text', text: 'Let me pull the customer data.' },
		{
			type: 'tool-execute_sql',
			toolCallId: sqlCallId,
			toolName: 'execute_sql',
			toolState: 'output-available',
			toolInput: {
				sql_query: `SELECT customer_status AS status, COUNT(*) AS count FROM customers GROUP BY status ORDER BY count DESC`,
				name: 'Customer count by status',
			},
			toolOutput: {
				_version: '1',
				data: [
					{ status: 'returned', count: 38 },
					{ status: 'new', count: 32 },
					{ status: 'repeat', count: 30 },
				],
				row_count: 3,
				columns: ['status', 'count'],
				id: queryId,
				dialect: 'duckdb',
			},
		},
		{
			type: 'text',
			text: 'We have **100 customers** in total:\n\n- **Returned**: 38 (38%) — customers who came back after their initial purchase\n- **New**: 32 (32%) — recently acquired\n- **Repeat**: 30 (30%) — loyal, recurring buyers\n\nThe relatively even distribution suggests a healthy customer lifecycle, though there\'s an opportunity to convert more "returned" customers into "repeat" buyers.',
		},
	]);
}

/** Conversation 3 — payment methods breakdown. */
async function seedOrdersConversation(tx: Tx, userId: string, projectId: string) {
	const chatId = crypto.randomUUID();
	const sqlCallId = `call-${crypto.randomUUID()}`;
	const queryId = `query_${crypto.randomUUID().slice(0, 8)}` as const;

	await tx.insert(s.chat).values({ id: chatId, userId, projectId, title: 'Payment Methods Breakdown' }).execute();

	await insertMessage(tx, chatId, 'user', [{ type: 'text', text: 'What payment methods are our customers using?' }]);

	await insertMessage(tx, chatId, 'assistant', [
		{ type: 'text', text: "I'll look at the payment method distribution." },
		{
			type: 'tool-execute_sql',
			toolCallId: sqlCallId,
			toolName: 'execute_sql',
			toolState: 'output-available',
			toolInput: {
				sql_query: `SELECT payment_method, COUNT(*) AS transaction_count, SUM(amount) AS total_amount FROM stg_payments WHERE status = 'success' GROUP BY payment_method ORDER BY total_amount DESC`,
				name: 'Payment methods breakdown',
			},
			toolOutput: {
				_version: '1',
				data: [
					{ payment_method: 'credit_card', transaction_count: 15, total_amount: 1350 },
					{ payment_method: 'coupon', transaction_count: 10, total_amount: 750 },
					{ payment_method: 'bank_transfer', transaction_count: 8, total_amount: 600 },
					{ payment_method: 'gift_card', transaction_count: 5, total_amount: 375 },
				],
				row_count: 4,
				columns: ['payment_method', 'transaction_count', 'total_amount'],
				id: queryId,
				dialect: 'duckdb',
			},
		},
		{
			type: 'text',
			text: "Here's the breakdown:\n\n1. **Credit card** — 15 transactions ($1,350) — the most popular method\n2. **Coupon** — 10 transactions ($750)\n3. **Bank transfer** — 8 transactions ($600)\n4. **Gift card** — 5 transactions ($375)\n\nCredit cards account for nearly 44% of total revenue. Consider offering incentives for bank transfers to reduce processing fees.",
		},
	]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type TextPart = { type: 'text'; text: string };
type ToolPart = {
	type: `tool-${string}`;
	toolCallId: string;
	toolName: string;
	toolState: 'output-available';
	toolInput: unknown;
	toolOutput: unknown;
};
type SeedPart = TextPart | ToolPart;

async function insertMessage(tx: Tx, chatId: string, role: 'user' | 'assistant', parts: SeedPart[]) {
	const msgId = crypto.randomUUID();
	await tx
		.insert(s.chatMessage)
		.values({
			id: msgId,
			chatId,
			role,
			...(role === 'assistant' && {
				stopReason: 'stop' as const,
				llmProvider: 'anthropic' as const,
				llmModelId: 'claude-sonnet-4-20250514',
			}),
		})
		.execute();

	const rows = parts.map((p, i) => {
		if (p.type === 'text') {
			return { messageId: msgId, order: i, type: 'text' as const, text: p.text };
		}
		return {
			messageId: msgId,
			order: i,
			type: p.type as typeof s.messagePart.$inferInsert.type,
			toolCallId: p.toolCallId,
			toolName: p.toolName,
			toolState: p.toolState,
			toolInput: p.toolInput,
			toolOutput: p.toolOutput,
		};
	});

	await tx.insert(s.messagePart).values(rows).execute();
}

async function upsertOrg(tx: Tx, values: { name: string; slug: string }) {
	const existing = await tx.query.organization.findFirst({ where: (o, { eq }) => eq(o.slug, values.slug) });
	if (existing) return [existing] as const;
	return tx.insert(s.organization).values(values).returning().execute();
}

async function upsertProject(tx: Tx, values: { name: string; type: 'local'; path: string; orgId: string }) {
	const existing = await tx.query.project.findFirst({ where: (p, { eq }) => eq(p.path, values.path) });
	if (existing) return [existing] as const;
	return tx.insert(s.project).values(values).returning().execute();
}

async function ensureOrgMember(tx: Tx, orgId: string, userId: string, role: 'admin' | 'user') {
	const existing = await tx.query.orgMember.findFirst({
		where: (m, { and, eq }) => and(eq(m.orgId, orgId), eq(m.userId, userId)),
	});
	if (!existing) {
		await tx.insert(s.orgMember).values({ orgId, userId, role }).execute();
	}
}

async function ensureProjectMember(tx: Tx, projectId: string, userId: string, role: 'admin' | 'user') {
	const existing = await tx.query.projectMember.findFirst({
		where: (m, { and, eq }) => and(eq(m.projectId, projectId), eq(m.userId, userId)),
	});
	if (!existing) {
		await tx.insert(s.projectMember).values({ projectId, userId, role }).execute();
	}
}

seed()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
