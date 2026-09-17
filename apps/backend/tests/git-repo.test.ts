import { describe, expect, it } from 'vitest';

import { GitOperationError, toGitError } from '../src/utils/git-repo';

describe('toGitError', () => {
	it.each(['clone', 'push'] as const)('preserves %s operation and stderr details', (operation) => {
		const error = toGitError(
			{
				message: 'Command failed: git https://oauth2:secret-token@gitlab.com/nao/context.git',
				stderr: 'Unauthorized\nfatal: Could not read from remote repository.',
			},
			operation,
		);

		expect(error).toBeInstanceOf(GitOperationError);
		expect(error.operation).toBe(operation);
		expect(error.message).toBe('Unauthorized\nfatal: Could not read from remote repository.');
		expect(error.details).toBe(error.message);
	});

	it('keeps raw details when presenting a normalized error', () => {
		const error = toGitError(
			{
				code: 'ETIMEDOUT',
				message: 'Command failed: git clone https://oauth2:secret-token@gitlab.com/nao/context.git',
			},
			'clone',
		);

		expect(error.message).toBe('Git did not respond before the operation timed out.');
		expect(error.details).toContain('secret-token');
	});
});
