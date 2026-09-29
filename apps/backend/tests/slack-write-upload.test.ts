import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

const { uploadV2, readUserFileBytes } = vi.hoisted(() => ({
	uploadV2: vi.fn(async () => ({ ok: true })),
	readUserFileBytes: vi.fn(async () => Buffer.from('id,name\n1,Ada\n')),
}));

vi.mock('@slack/web-api', () => ({
	WebClient: class {
		files = { uploadV2 };
	},
}));

vi.mock('../src/services/storage/user-files', () => ({ readUserFileBytes }));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { ProjectSlackBot } from '../src/services/slack';
import type { UIMessagePart } from '../src/types/chat';
import type { ConversationContext, StreamState } from '../src/types/messaging-provider';
import { logger } from '../src/utils/logger';

const PROJECT_ID = 'project-1';
const USER_ID = 'user-1';

type WritePart = Extract<UIMessagePart, { type: 'tool-write' }>;

function createBot(): ProjectSlackBot {
	return new ProjectSlackBot({
		projectId: PROJECT_ID,
		botToken: 'xoxb-test',
		signingSecret: 'secret',
		redirectUrl: 'https://nao.example.com/',
		autoCreateUsersEnabled: false,
		autoCreateUsersDomains: [],
		transportMode: 'webhook',
		appToken: '',
		replyMode: 'thread',
		dmScopeMissing: false,
	});
}

function createState(): StreamState {
	return {
		renderedToolCallIds: new Set(),
		sqlOutputs: new Map(),
		lastUpdateAt: 0,
		toolGroup: new Map(),
		toolGroupBlockIndex: -1,
	};
}

function createContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
	return {
		thread: { id: 'slack:C123:1700000000.000100' } as ConversationContext['thread'],
		userMessage: {} as ConversationContext['userMessage'],
		user: { id: USER_ID } as ConversationContext['user'],
		chatId: 'chat-1',
		convMessage: null,
		blocks: [],
		textBlockIndex: -1,
		textBlockCount: 0,
		isNewChat: false,
		modelId: undefined,
		timezone: undefined,
		...overrides,
	};
}

function createWritePart(overrides: Record<string, unknown> = {}): WritePart {
	return {
		type: 'tool-write',
		toolCallId: 'call-1',
		state: 'output-available',
		input: { file_path: '/home/reports/accounts.csv', content: 'id,name\n1,Ada\n' },
		output: { _version: '1', path: '/home/reports/accounts.csv', size: 14 },
		...overrides,
	} as unknown as WritePart;
}

async function handleWritePart(bot: ProjectSlackBot, part: WritePart, state: StreamState, ctx: ConversationContext) {
	await bot['_handleWritePart'](part, state, ctx);
}

describe('ProjectSlackBot written file delivery', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readUserFileBytes.mockResolvedValue(Buffer.from('id,name\n1,Ada\n'));
	});

	it('uploads the written file into the thread', async () => {
		const bot = createBot();
		const state = createState();

		await handleWritePart(bot, createWritePart(), state, createContext());

		expect(readUserFileBytes).toHaveBeenCalledWith(
			{ projectId: PROJECT_ID, userId: USER_ID },
			'reports/accounts.csv',
		);
		expect(uploadV2).toHaveBeenCalledTimes(1);
		expect(uploadV2.mock.calls[0]?.[0]).toMatchObject({
			channel_id: 'C123',
			thread_ts: '1700000000.000100',
			filename: 'accounts.csv',
		});
		expect(state.renderedToolCallIds.has('call-1')).toBe(true);
	});

	it('uploads each written file once', async () => {
		const bot = createBot();
		const state = createState();
		const ctx = createContext();

		await handleWritePart(bot, createWritePart(), state, ctx);
		await handleWritePart(bot, createWritePart(), state, ctx);

		expect(uploadV2).toHaveBeenCalledTimes(1);
	});

	it('waits for the tool output before uploading', async () => {
		const bot = createBot();

		await handleWritePart(
			bot,
			createWritePart({ state: 'input-available', output: undefined }),
			createState(),
			createContext(),
		);

		expect(readUserFileBytes).not.toHaveBeenCalled();
		expect(uploadV2).not.toHaveBeenCalled();
	});

	it('skips the upload without a resolved user', async () => {
		const bot = createBot();

		await handleWritePart(bot, createWritePart(), createState(), createContext({ user: null }));

		expect(uploadV2).not.toHaveBeenCalled();
	});

	it('logs and keeps streaming when the file cannot be read', async () => {
		const bot = createBot();
		readUserFileBytes.mockRejectedValueOnce(new Error('No such file in permanent storage: reports/accounts.csv'));

		await expect(handleWritePart(bot, createWritePart(), createState(), createContext())).resolves.toBeUndefined();

		expect(uploadV2).not.toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalledTimes(1);
	});
});
