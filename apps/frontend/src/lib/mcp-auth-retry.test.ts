import { describe, expect, it } from 'vitest';

import type { UIMessage } from '@nao/backend/chat';
import { lastUserMessagePayload } from './mcp-auth-retry';

const userMessage = (parts: UIMessage['parts'], extra: Partial<UIMessage> = {}): UIMessage =>
	({ id: 'user', role: 'user', parts, ...extra }) as UIMessage;

describe('lastUserMessagePayload', () => {
	it('returns the text and citation from the most recent user message', () => {
		const payload = lastUserMessagePayload([
			userMessage([{ type: 'text', text: 'older' }]),
			{ id: 'assistant', role: 'assistant', parts: [] } as unknown as UIMessage,
			userMessage([{ type: 'text', text: ' latest ' }], {
				citation: { url: 'https://example.com' },
			} as Partial<UIMessage>),
		]);

		expect(payload).toEqual({ text: 'latest', citation: { url: 'https://example.com' } });
	});

	it('reconstructs image-only payloads from file parts', () => {
		const payload = lastUserMessagePayload([
			userMessage([
				{
					type: 'file',
					mediaType: 'image/png',
					url: 'data:image/png;base64,abc123',
				} as UIMessage['parts'][number],
			]),
		]);

		expect(payload).toEqual({ text: '', images: [{ mediaType: 'image/png', data: 'abc123' }] });
	});

	it('ignores non-image files and empty user messages', () => {
		const payload = lastUserMessagePayload([
			userMessage([
				{
					type: 'file',
					mediaType: 'application/pdf',
					url: 'data:application/pdf;base64,abc123',
				} as UIMessage['parts'][number],
			]),
		]);

		expect(payload).toBeNull();
	});
});
