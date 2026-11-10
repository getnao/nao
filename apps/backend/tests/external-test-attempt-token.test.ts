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

	it('round-trips the attempt, project and user scope', () => {
		const created = createExternalTestAttemptToken('project-1', 'user-1');

		expect(created.token).toMatch(/^nao_test_/);
		expect(verifyExternalTestAttemptToken(created.token)).toEqual({
			id: created.id,
			projectId: 'project-1',
			userId: 'user-1',
			exp: created.expiresAt.getTime(),
		});
	});

	it('rejects tampering', () => {
		const { token } = createExternalTestAttemptToken('project-1', 'user-1');
		const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

		expect(verifyExternalTestAttemptToken(tampered)).toBeNull();
	});

	it('rejects expired attempts', () => {
		const { token, expiresAt } = createExternalTestAttemptToken('project-1', 'user-1');
		vi.setSystemTime(expiresAt.getTime() + 1);

		expect(verifyExternalTestAttemptToken(token)).toBeNull();
	});
});
