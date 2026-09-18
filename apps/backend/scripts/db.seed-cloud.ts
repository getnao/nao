import path from 'node:path';

import { validateStoryCode } from '@nao/shared/story-validation';
import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';

const PASSWORD = 'password';
const EXAMPLE_PROJECT_PATH = path.resolve(import.meta.dirname, '../../../example');
const EXAMPLE_PROJECT_NAME = 'Jaffle Shop';
const ANALYTICS_SHOWCASE_SLUG = 'jaffle-shop-analytics';

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
	let seededConversationCount = 0;

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

		seededConversationCount = await seedConversations(tx, userIds['admin@company1.com'], project.id);
	});

	console.log('Done.');
	console.log('');
	for (const u of USERS) {
		console.log(`  ${u.email} / ${PASSWORD}`);
	}
	console.log('');
	console.log(`  Org: ${COMPANY1_ORG.name} (admin@company1.com + user@company1.com)`);
	console.log(`  Project: ${EXAMPLE_PROJECT_NAME} → ${EXAMPLE_PROJECT_PATH}`);
	console.log(
		seededConversationCount > 0
			? `  Conversations added: ${seededConversationCount} (admin@company1.com)`
			: '  Conversations: already seeded (admin@company1.com)',
	);
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

async function seedConversations(tx: Tx, userId: string, projectId: string) {
	const existing = await tx.query.chat.findFirst({ where: (c, { eq }) => eq(c.userId, userId) });
	const showcaseAdded = await seedAnalyticsShowcaseConversation(tx, userId, projectId);
	if (existing) {
		return Number(showcaseAdded);
	}

	await seedCustomerConversation(tx, userId, projectId);
	await seedOrdersConversation(tx, userId, projectId);
	return Number(showcaseAdded) + 2;
}

/**
 * Conversation 1 — starred, with an execute_sql + display_chart in the chat
 * and a story showcasing the available chart cards.
 */
async function seedAnalyticsShowcaseConversation(tx: Tx, userId: string, projectId: string) {
	const [existing] = await tx
		.select({ id: s.story.id })
		.from(s.story)
		.innerJoin(s.chat, eq(s.story.chatId, s.chat.id))
		.where(
			and(eq(s.story.slug, ANALYTICS_SHOWCASE_SLUG), eq(s.chat.userId, userId), eq(s.chat.projectId, projectId)),
		)
		.limit(1)
		.execute();
	if (existing) {
		return false;
	}

	const chatId = crypto.randomUUID();
	const sqlCallId = `call-${crypto.randomUUID()}`;
	const chartCallId = `call-${crypto.randomUUID()}`;
	const storyCallId = `call-${crypto.randomUUID()}`;
	const queryId = `query_${crypto.randomUUID().slice(0, 8)}` as const;

	await tx
		.insert(s.chat)
		.values({ id: chatId, userId, projectId, title: 'Jaffle Shop Analytics', isStarred: true })
		.execute();

	const revenueData = [
		{ month: '2018-01', revenue: 496, orders: 29 },
		{ month: '2018-02', revenue: 415, orders: 27 },
		{ month: '2018-03', revenue: 622, orders: 35 },
		{ month: '2018-04', revenue: 139, orders: 8 },
	];

	await insertMessage(tx, chatId, 'user', [
		{ type: 'text', text: 'Build me an analytics dashboard for the Jaffle Shop example.' },
	]);

	await insertMessage(tx, chatId, 'assistant', [
		{ type: 'text', text: "I'll analyze monthly revenue and order volume from the DuckDB orders data." },
		{
			type: 'tool-execute_sql',
			toolCallId: sqlCallId,
			toolName: 'execute_sql',
			toolState: 'output-available',
			toolInput: {
				sql_query: `SELECT strftime(order_date, '%Y-%m') AS month, SUM(amount) AS revenue, COUNT(*) AS orders FROM orders GROUP BY month ORDER BY month`,
				name: 'Monthly revenue and orders',
			},
			toolOutput: {
				_version: '1',
				data: revenueData,
				row_count: 4,
				columns: ['month', 'revenue', 'orders'],
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
				chart_type: 'line',
				x_axis_key: 'month',
				x_axis_type: 'category',
				series: [{ data_key: 'revenue', label: 'Revenue ($)', color: '#6366f1' }],
				title: 'Monthly Revenue Trend',
			},
			toolOutput: { _version: '1', success: true },
		},
		{
			type: 'text',
			text: 'The Jaffle Shop generated $1,672 from 99 orders. March was the strongest month with $622 in revenue from 35 orders.',
		},
	]);

	await insertMessage(tx, chatId, 'user', [
		{ type: 'text', text: 'Great, turn that into a dashboard with several kinds of cards.' },
	]);

	const storySlug = ANALYTICS_SHOWCASE_SLUG;
	const storyCode = [
		'# Jaffle Shop Analytics',
		'',
		'## Overview',
		'',
		'<grid>',
		`<chart query_id="${queryId}" chart_type="kpi_card" x_axis_key="month" series='[{"data_key":"revenue","label":"Latest revenue","color":"#6366f1"}]' comparison_mode="percentage" />`,
		`<chart query_id="${queryId}" chart_type="kpi_card" x_axis_key="month" series='[{"data_key":"orders","label":"Latest orders","color":"#0ea5e9"}]' comparison_mode="variation" />`,
		`<chart query_id="${queryId}" chart_type="donut" x_axis_key="month" series='[{"data_key":"revenue","label":"Revenue","color":"#8b5cf6"}]' title="Revenue Mix" />`,
		'</grid>',
		'',
		'## Monthly Performance',
		'',
		'<grid widths="2,1">',
		`<chart query_id="${queryId}" chart_type="line" x_axis_key="month" series='[{"data_key":"revenue","label":"Revenue ($)","color":"#6366f1"}]' title="Revenue Trend" show_data_labels="true" />`,
		`<chart query_id="${queryId}" chart_type="bar" x_axis_key="month" series='[{"data_key":"orders","label":"Orders","color":"#0ea5e9"}]' title="Order Volume" show_data_labels="true" />`,
		'</grid>',
		'',
		`<chart query_id="${queryId}" chart_type="mixed" x_axis_key="month" series='[{"data_key":"revenue","label":"Revenue ($)","color":"#6366f1","series_type":"bar","y_axis":"left"},{"data_key":"orders","label":"Orders","color":"#f97316","series_type":"line","y_axis":"right"}]' y_axis_label="Revenue ($)" y_axis_right_label="Orders" title="Revenue and Orders" />`,
		'',
		'## Monthly Detail',
		'',
		`<table query_id="${queryId}" title="Revenue and Orders by Month" />`,
		'',
		'March led the period with **$622** in revenue and **35 orders**. April is a partial month in this dataset.',
	].join('\n');
	const storyErrors = validateStoryCode(storyCode);
	if (storyErrors.length > 0) {
		throw new Error(`Invalid seeded story: ${storyErrors.map((error) => error.message).join('; ')}`);
	}

	await insertMessage(tx, chatId, 'assistant', [
		{
			type: 'tool-story',
			toolCallId: storyCallId,
			toolName: 'story',
			toolState: 'output-available',
			toolInput: { action: 'create', id: storySlug, title: 'Jaffle Shop Analytics', code: storyCode },
			toolOutput: {
				_version: '1',
				success: true,
				id: storySlug,
				version: 1,
				code: storyCode,
				title: 'Jaffle Shop Analytics',
			},
		},
		{
			type: 'text',
			text: "I've created a Jaffle Shop Analytics dashboard with seven cards. You can find it in your stories.",
		},
	]);

	const storyId = crypto.randomUUID();
	await tx.insert(s.story).values({ id: storyId, chatId, slug: storySlug, title: 'Jaffle Shop Analytics' }).execute();
	await tx
		.insert(s.storyVersion)
		.values({ storyId, version: 1, code: storyCode, action: 'create', source: 'assistant' })
		.execute();
	return true;
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
	if (existing) {
		return [existing] as const;
	}
	return tx.insert(s.organization).values(values).returning().execute();
}

async function upsertProject(tx: Tx, values: { name: string; type: 'local'; path: string; orgId: string }) {
	const existing = await tx.query.project.findFirst({ where: (p, { eq }) => eq(p.path, values.path) });
	if (existing) {
		return [existing] as const;
	}
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
