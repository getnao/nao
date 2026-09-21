import '../src/env';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import type { MattermostConfig } from '../src/queries/project-mattermost-config.queries';
import { mattermostService } from '../src/services/mattermost';
import { createMattermostFeedbackMetadata, MATTERMOST_FEEDBACK_PROP } from '../src/services/mattermost-helpers';

type ReactionEventInput = {
	added: boolean;
	emoji: { name: string };
	message?: { raw: unknown };
	messageId: string;
	user: { isBot: boolean; isMe: boolean };
};

const chatHarness = vi.hoisted(() => ({
	reactionHandlers: [] as Array<(event: ReactionEventInput) => Promise<void>>,
}));

vi.mock('../src/db/db', async () => {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');
	const sqliteSchema = await import('../src/db/sqlite-schema');

	const sqlite = new Database(':memory:');
	const statements = await generateSQLiteMigration(
		await generateSQLiteDrizzleJson({}),
		await generateSQLiteDrizzleJson(sqliteSchema),
	);
	for (const statement of statements) {
		sqlite.exec(statement);
	}
	sqlite.pragma('foreign_keys = ON');

	return { db: drizzle(sqlite, { schema: sqliteSchema }) };
});

vi.mock('chat', () => ({
	Chat: class {
		onAction(): void {}
		onNewMention(): void {}
		onSubscribedMessage(): void {}
		onNewMessage(): void {}
		onReaction(handler: (event: ReactionEventInput) => Promise<void>): void {
			chatHarness.reactionHandlers.push(handler);
		}
		async initialize(): Promise<void> {}
		getState(): Record<string, never> {
			return {};
		}
	},
	ThreadImpl: class {},
	deriveChannelId: vi.fn(),
}));

vi.mock('chat-adapter-mattermost', () => ({
	createMattermostAdapter: vi.fn(() => ({
		addReaction: vi.fn(),
		disconnect: vi.fn(),
	})),
}));

vi.mock('../src/services/agent', () => ({
	agentService: {
		create: vi.fn(),
		get: vi.fn(),
	},
}));

vi.mock('../src/services/posthog', () => ({
	PostHogEvent: { MessageSent: 'message_sent' },
	posthog: { capture: vi.fn() },
}));

vi.mock('../src/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}));

const PROJECT_ID = 'mattermost-reaction-project';
const MESSAGE_ID = 'mattermost-reaction-message';
const POST_ID = 'mattermost-reaction-post';
const config: MattermostConfig = {
	projectId: PROJECT_ID,
	baseUrl: 'https://mattermost.example',
	botToken: 'bot-token',
	redirectUrl: 'https://nao.example',
	interactiveButtonsEnabled: false,
};

function reaction(input: Partial<ReactionEventInput> = {}): ReactionEventInput {
	return {
		added: true,
		emoji: { name: 'thumbs_up' },
		messageId: POST_ID,
		user: { isBot: false, isMe: false },
		...input,
	};
}

async function readVote(): Promise<'up' | 'down' | null> {
	const [feedback] = await db
		.select({ vote: s.messageFeedback.vote })
		.from(s.messageFeedback)
		.where(eq(s.messageFeedback.messageId, MESSAGE_ID));
	return feedback?.vote ?? null;
}

describe('Mattermost reaction service', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({
			id: 'mattermost-reaction-user',
			name: 'Mattermost Reaction User',
			email: 'mattermost-reaction@example.com',
		});
		await db.insert(s.project).values({
			id: PROJECT_ID,
			name: 'Mattermost Reaction Project',
			type: 'local',
			path: '/tmp/mattermost-reaction-project',
		});
		await db.insert(s.chat).values({
			id: 'mattermost-reaction-chat',
			projectId: PROJECT_ID,
			userId: 'mattermost-reaction-user',
		});
		await db.insert(s.chatMessage).values({
			id: MESSAGE_ID,
			chatId: 'mattermost-reaction-chat',
			role: 'assistant',
		});
		await mattermostService.startForProject(config);
	});

	beforeEach(async () => {
		await db.delete(s.messageFeedback);
		vi.unstubAllGlobals();
	});

	afterAll(async () => {
		await mattermostService.stopProject(PROJECT_ID);
		db.$client.close();
	});

	it('uses event post props to persist additions and removals', async () => {
		const metadata = createMattermostFeedbackMetadata(PROJECT_ID, POST_ID, MESSAGE_ID);
		const post = {
			id: POST_ID,
			channel_id: 'channel-1',
			props: { [MATTERMOST_FEEDBACK_PROP]: metadata },
		};
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await chatHarness.reactionHandlers.at(-1)!(reaction({ message: { raw: post } }));
		expect(await readVote()).toBe('up');

		await chatHarness.reactionHandlers.at(-1)!(
			reaction({ emoji: { name: 'thumbs_down' }, message: { raw: post } }),
		);
		expect(await readVote()).toBe('down');

		await chatHarness.reactionHandlers.at(-1)!(
			reaction({ added: false, emoji: { name: 'thumbs_down' }, message: { raw: post } }),
		);
		expect(await readVote()).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('ignores bot reactions and unknown emoji before reading the post', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await chatHarness.reactionHandlers.at(-1)!(reaction({ user: { isBot: true, isMe: false } }));
		await chatHarness.reactionHandlers.at(-1)!(reaction({ emoji: { name: 'heart' } }));

		expect(await readVote()).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('ignores missing and malformed post props', async () => {
		await chatHarness.reactionHandlers.at(-1)!(
			reaction({ message: { raw: { id: POST_ID, channel_id: 'channel-1', props: {} } } }),
		);
		await chatHarness.reactionHandlers.at(-1)!(
			reaction({
				message: {
					raw: {
						id: POST_ID,
						channel_id: 'channel-1',
						props: { [MATTERMOST_FEEDBACK_PROP]: { version: 1 } },
					},
				},
			}),
		);

		expect(await readVote()).toBeNull();
	});

	it('restores feedback from Mattermost props after recreating the project bot', async () => {
		const metadata = createMattermostFeedbackMetadata(PROJECT_ID, POST_ID, MESSAGE_ID);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({
					id: POST_ID,
					channel_id: 'channel-1',
					props: { [MATTERMOST_FEEDBACK_PROP]: metadata },
				}),
			),
		);
		await mattermostService.syncProject(config, PROJECT_ID);

		await chatHarness.reactionHandlers.at(-1)!(reaction({ emoji: { name: 'thumbs_down' } }));

		expect(await readVote()).toBe('down');
	});
});
