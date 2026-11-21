// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from '@nao/backend/chat';
import type { UIMessageChunk } from 'ai';
import type { LocalAgentEvent } from '@/lib/local-agent';

import { LocalAgentChatTransport } from '@/lib/local-agent-transport';

const bridge = vi.hoisted(() => ({
	startLocalAgentTurn: vi.fn(),
	stopLocalAgentTurn: vi.fn(),
}));

vi.mock('@/lib/local-agent', () => bridge);

const TURN = {
	chatId: 'chat-1',
	isNewChat: true,
	newChat: { id: 'chat-1', projectId: 'project-1', title: 'Orders', isStarred: false, createdAt: 1, updatedAt: 1 },
	userMessageId: 'user-message-1',
	systemPrompt: 'You are nao.',
	history: null,
	mcp: { url: '/api/local-agent/mcp', token: 'nao_local_token' },
};

const ANSWER: LocalAgentEvent[] = [
	{ type: 'chunk', chunk: { type: 'start-step' } },
	{ type: 'chunk', chunk: { type: 'text-start', id: 'text-1' } },
	{ type: 'chunk', chunk: { type: 'text-delta', id: 'text-1', delta: '42 orders' } },
	{ type: 'chunk', chunk: { type: 'text-end', id: 'text-1' } },
	{ type: 'chunk', chunk: { type: 'finish-step' } },
	{ type: 'done', modelId: 'claude-sonnet-5-5', stopReason: 'stop' },
];

const userMessage = { id: 'draft', role: 'user', parts: [{ type: 'text', text: 'How many orders?' }] } as UIMessage;
const fetchMock = vi.fn();

function sendMessage(abortSignal?: AbortSignal) {
	const transport = new LocalAgentChatTransport(
		() => ({ provider: 'claude', model: 'sonnet', displayName: 'Sonnet 5.5' }),
		() => undefined,
	);
	return transport.sendMessages({
		trigger: 'submit-message',
		chatId: 'new',
		messageId: undefined,
		messages: [userMessage],
		abortSignal,
	});
}

async function readAll(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
	const reader = stream.getReader();
	const chunks: UIMessageChunk[] = [];
	for (let next = await reader.read(); !next.done; next = await reader.read()) {
		chunks.push(next.value);
	}
	return chunks;
}

function postedBody(url: string) {
	const call = fetchMock.mock.calls.find(([calledUrl]) => calledUrl === url);
	return call ? JSON.parse(call[1].body) : undefined;
}

describe('LocalAgentChatTransport', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockImplementation(async (url: string) =>
			Response.json(url === '/api/local-agent/turns' ? TURN : { ok: true }),
		);
		bridge.startLocalAgentTurn.mockImplementation(async (_turn, onEvent: (event: LocalAgentEvent) => void) => {
			queueMicrotask(() => ANSWER.forEach(onEvent));
			return 'turn-1';
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it('streams the answer like the server agent and saves it once the turn ends', async () => {
		const chunks = await readAll(await sendMessage());

		expect(chunks.map((chunk) => chunk.type)).toEqual([
			'start',
			'data-newChat',
			'data-newUserMessage',
			'start-step',
			'text-start',
			'text-delta',
			'text-end',
			'finish-step',
			'finish',
		]);
		expect(bridge.startLocalAgentTurn.mock.calls[0][0]).toMatchObject({
			provider: 'claude',
			model: 'sonnet',
			prompt: 'How many orders?',
			mcp: { url: `${window.location.origin}/api/local-agent/mcp`, token: 'nao_local_token' },
		});
		expect(postedBody('/api/local-agent/turns/complete')).toMatchObject({
			chatId: 'chat-1',
			modelId: 'claude-sonnet-5-5',
			stopReason: 'stop',
			message: { role: 'assistant', parts: [{ type: 'step-start' }, { type: 'text', text: '42 orders' }] },
		});
	});

	it('stops the turn on the desktop app when the user stops the chat', async () => {
		bridge.startLocalAgentTurn.mockResolvedValue('turn-1');
		const abortController = new AbortController();
		await sendMessage(abortController.signal);
		await vi.waitFor(() => expect(bridge.startLocalAgentTurn).toHaveBeenCalled());

		abortController.abort();

		expect(bridge.stopLocalAgentTurn).toHaveBeenCalledWith('turn-1');
	});

	it('refuses attachments, which a local turn cannot send yet', async () => {
		const withImage = {
			...userMessage,
			parts: [...userMessage.parts, { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }],
		} as UIMessage;
		const transport = new LocalAgentChatTransport(
			() => ({ provider: 'claude', model: 'sonnet', displayName: 'Sonnet 5.5' }),
			() => undefined,
		);

		await expect(
			transport.sendMessages({
				trigger: 'submit-message',
				chatId: 'new',
				messageId: undefined,
				messages: [withImage],
				abortSignal: undefined,
			}),
		).rejects.toThrow('Attachments are not supported');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
