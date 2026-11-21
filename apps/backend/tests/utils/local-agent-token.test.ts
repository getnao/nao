import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateEmbedToken } from '../../src/utils/embed-token';
import { generateLocalAgentToken, verifyLocalAgentToken } from '../../src/utils/local-agent-token';

const CLAIMS = { userId: 'user-1', projectId: 'project-1', chatId: 'chat-1' };

describe('local agent token', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('round-trips the chat it gives access to', () => {
		expect(verifyLocalAgentToken(generateLocalAgentToken(CLAIMS))).toMatchObject(CLAIMS);
	});

	it('rejects a token whose chat was swapped', () => {
		const token = generateLocalAgentToken(CLAIMS);
		const [payload, signature] = token.slice('nao_local_'.length).split('.');
		const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
		const forged = Buffer.from(JSON.stringify({ ...claims, chatId: 'chat-2' })).toString('base64url');

		expect(verifyLocalAgentToken(`nao_local_${forged}.${signature}`)).toBeNull();
	});

	it('rejects an expired token', () => {
		vi.useFakeTimers();
		const token = generateLocalAgentToken(CLAIMS);
		vi.advanceTimersByTime(13 * 60 * 60 * 1000);

		expect(verifyLocalAgentToken(token)).toBeNull();
	});

	it.each([
		['an embed token signed with the same secret', generateEmbedToken('chart', 'chart-1', 'project-1')],
		['an embed token given the local prefix', `nao_local_${generateEmbedToken('chart', 'chart-1', 'project-1')}`],
		['garbage', 'nao_local_not-a-token'],
	])('rejects %s', (_label, token) => {
		expect(verifyLocalAgentToken(token)).toBeNull();
	});
});
