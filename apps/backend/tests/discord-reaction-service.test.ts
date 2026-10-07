import '../src/env';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import type { DiscordConfig } from '../src/queries/project-discord-config.queries';
import { discordService } from '../src/services/discord';

type ReactionEventInput = {
	added: boolean;
	emoji: { name: string };
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

vi.mock('chat', () => {
	class Chat {
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
	}
	return {
		Chat,
		Message: class {},
		Thread: class {},
		Card: vi.fn((element: unknown) => element),
		CardText: vi.fn((content: string) => ({ type: 'text', content })),
	};
});

vi.mock('@chat-adapter/discord', () => ({
	createDiscordAdapter: vi.fn(() => ({
		addReaction: vi.fn(),
		getUser: vi.fn(),
		startGatewayListener: vi.fn(async () => new Response(null, { status: 200 })),
	})),
}));

vi.mock('../src/services/agent', () => ({
	agentService: {
		create: vi.fn(),
		get: vi.fn(),
	},
}));

vi.mock('../src/services/posthog', () => ({
	PostHogEvent: { MessageSent: 'message_sent', DiscordConfigured: 'discord_configured' },
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

const PROJECT_ID = 'discord-reaction-project';
const MESSAGE_ID = 'discord-reaction-message';
const THREAD_ID = 'discord:guild-1:channel-1';
const POST_ID = 'discord-answer-post';
const UNKNOWN_POST_ID = 'discord-answer-unknown';
const config: DiscordConfig = {
	projectId: PROJECT_ID,
	botToken: 'bot-token',
	applicationId: 'application-id',
	publicKey: 'public-key',
	redirectUrl: 'https://nao.example',
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

describe('Discord reaction service', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({
			id: 'discord-reaction-user',
			name: 'Discord Reaction User',
			email: 'discord-reaction@example.com',
		});
		await db.insert(s.project).values({
			id: PROJECT_ID,
			name: 'Discord Reaction Project',
			type: 'local',
			path: '/tmp/discord-reaction-project',
		});
		await db.insert(s.chat).values({
			id: 'discord-reaction-chat',
			projectId: PROJECT_ID,
			userId: 'discord-reaction-user',
			discordThreadId: THREAD_ID,
		});
		await db.insert(s.chatMessage).values({
			id: MESSAGE_ID,
			chatId: 'discord-reaction-chat',
			role: 'assistant',
			discordMessageId: POST_ID,
		});
		await discordService.startForProject(config);
	});

	beforeEach(async () => {
		await db.delete(s.messageFeedback);
		vi.unstubAllGlobals();
	});

	afterAll(async () => {
		await discordService.stopProject(PROJECT_ID);
		db.$client.close();
	});

	it('persists additions and removals on the reacted answer message', async () => {
		await chatHarness.reactionHandlers.at(-1)!(reaction({ emoji: { name: 'thumbs_up' } }));
		expect(await readVote()).toBe('up');

		await chatHarness.reactionHandlers.at(-1)!(reaction({ emoji: { name: '👍' } }));
		expect(await readVote()).toBe('up');

		await chatHarness.reactionHandlers.at(-1)!(reaction({ emoji: { name: 'thumbs_down' } }));
		expect(await readVote()).toBe('down');

		await chatHarness.reactionHandlers.at(-1)!(reaction({ added: false, emoji: { name: 'thumbs_down' } }));
		expect(await readVote()).toBeNull();
	});

	it('ignores bot reactions and unknown emoji', async () => {
		await chatHarness.reactionHandlers.at(-1)!(reaction({ user: { isBot: true, isMe: false } }));
		await chatHarness.reactionHandlers.at(-1)!(reaction({ emoji: { name: 'heart' } }));

		expect(await readVote()).toBeNull();
	});

	it('ignores reactions for messages that are not project answers', async () => {
		await chatHarness.reactionHandlers.at(-1)!(reaction({ messageId: UNKNOWN_POST_ID }));

		expect(await readVote()).toBeNull();
	});

	it('keeps persisting feedback after recreating the project bot', async () => {
		await discordService.syncProject(config, PROJECT_ID);

		await chatHarness.reactionHandlers.at(-1)!(reaction({ emoji: { name: 'thumbs_down' } }));

		expect(await readVote()).toBe('down');
	});
});
