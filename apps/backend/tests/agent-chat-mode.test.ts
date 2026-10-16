import { describe, expect, it } from 'vitest';

import { canAccessExampleChat, getChatModeMismatchError } from '../src/routes/agent';
import { AgentRequestSchema } from '../src/types/chat';

describe('agent chat modes', () => {
	it('accepts explicit example chat requests', () => {
		const request = AgentRequestSchema.parse({ message: { text: 'Show me revenue' }, mode: 'example' });
		expect(request.mode).toBe('example');
	});

	it('allows only requests that match the existing chat mode', () => {
		expect(getChatModeMismatchError(false, false)).toBeNull();
		expect(getChatModeMismatchError(true, true)).toBeNull();
		expect(getChatModeMismatchError(true, false)).toBe(
			'Regular conversations cannot be continued through onboarding',
		);
		expect(getChatModeMismatchError(false, true)).toBe(
			'Onboarding conversations must be continued through onboarding',
		);
	});

	it('allows users to resume their own example chats', () => {
		expect(
			canAccessExampleChat({
				chatId: 'chat-1',
				chatOwnerId: 'user-1',
				userId: 'user-1',
				exampleProjectAvailable: false,
			}),
		).toBe(true);
		expect(
			canAccessExampleChat({
				chatId: 'chat-1',
				chatOwnerId: 'user-2',
				userId: 'user-1',
				exampleProjectAvailable: true,
			}),
		).toBe(false);
	});

	it('only starts new example chats while the example project is available', () => {
		expect(
			canAccessExampleChat({
				chatId: undefined,
				chatOwnerId: undefined,
				userId: 'user-1',
				exampleProjectAvailable: true,
			}),
		).toBe(true);
		expect(
			canAccessExampleChat({
				chatId: undefined,
				chatOwnerId: undefined,
				userId: 'user-1',
				exampleProjectAvailable: false,
			}),
		).toBe(false);
	});
});
