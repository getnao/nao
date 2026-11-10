import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	createExternalTestAttemptToken,
	verifyExternalTestAttemptToken,
} from '../src/services/external-test-attempt-token';

describe('external test attempt tokens', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('round-trips the attempt, project and user scope', async () => {
		const created = await createExternalTestAttemptToken('project-1', 'user-1');

		expect(created.token).toMatch(/^nao_test_/);
		await expect(verifyExternalTestAttemptToken(created.token)).resolves.toEqual({
			id: created.id,
			projectId: 'project-1',
			userId: 'user-1',
			exp: created.expiresAt.getTime(),
		});
	});

	it('rejects tampering', async () => {
		const { token } = await createExternalTestAttemptToken('project-1', 'user-1');
		const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

		await expect(verifyExternalTestAttemptToken(tampered)).resolves.toBeNull();
	});

	it('rejects expired attempts', async () => {
		const { token, expiresAt } = await createExternalTestAttemptToken('project-1', 'user-1');
		vi.setSystemTime(expiresAt.getTime() + 1);

		await expect(verifyExternalTestAttemptToken(token)).resolves.toBeNull();
	});
});
