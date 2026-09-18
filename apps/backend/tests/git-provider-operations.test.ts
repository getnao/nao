import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
});

const mocks = vi.hoisted(() => ({
	execFileSync: vi.fn(),
	spawnSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
	execFileSync: mocks.execFileSync,
	spawnSync: mocks.spawnSync,
}));

import { GENERIC_GIT_PROVIDER } from '../src/services/generic-git';
import { checkoutNewBranch, commitAll } from '../src/services/git-repo';
import * as github from '../src/services/github';
import * as gitlab from '../src/services/gitlab';
import type { ReviewRequestProvider } from '../src/services/review-request-provider';
import { GitOperationError } from '../src/utils/git-repo';

const providers: Array<[string, Pick<ReviewRequestProvider, 'cloneRepo' | 'commitAllAndPushBranch'>, string]> = [
	['GitHub', github, 'nao/context'],
	['GitLab', gitlab, 'nao/context'],
	['generic Git', GENERIC_GIT_PROVIDER, 'https://example.com/nao/context.git'],
];

describe('Git provider operation errors', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.execFileSync.mockReturnValue(Buffer.from(''));
		mocks.spawnSync.mockReturnValue({
			error: undefined,
			status: 0,
			signal: null,
			stdout: '',
			stderr: '',
		});
	});

	it.each(providers)('labels %s clone failures as clone', (_name, provider, repository) => {
		mocks.execFileSync.mockImplementationOnce(() => {
			throw processError('clone failed');
		});

		expect(() => provider.cloneRepo('token', repository, '/tmp/context')).toThrowError(
			expect.objectContaining({ operation: 'clone' }),
		);
	});

	it.each(providers)('labels %s remote setup failures as configure-remote', (_name, provider, repository) => {
		mocks.execFileSync.mockReturnValueOnce(Buffer.from('')).mockImplementationOnce(() => {
			throw processError('remote setup failed');
		});

		let error: unknown;
		try {
			provider.cloneRepo('token', repository, '/tmp/context');
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(GitOperationError);
		expect(error).toMatchObject({ operation: 'configure-remote', details: 'remote setup failed' });
	});

	it.each([
		['checkout', 0],
		['add', 1],
		['commit', 2],
	] as const)('preserves the %s step in every provider commit flow', (operation, failureIndex) => {
		for (const [, provider, repository] of providers) {
			mocks.execFileSync.mockReset();
			mocks.execFileSync.mockImplementation((..._args: unknown[]) => {
				const callIndex = mocks.execFileSync.mock.calls.length - 1;
				if (callIndex === failureIndex) {
					throw processError(`${operation} failed`);
				}
				return Buffer.from('');
			});

			expect(() =>
				provider.commitAllAndPushBranch({
					token: 'token',
					repoFullName: repository,
					dir: '/tmp/context',
					branch: 'nao/change',
					message: 'Update context',
					author: { name: 'User', email: 'user@example.com' },
				}),
			).toThrowError(expect.objectContaining({ operation }));
		}
	});

	it('labels batch checkout failures as checkout', () => {
		mocks.execFileSync.mockImplementationOnce(() => {
			throw processError('checkout failed');
		});

		expect(() => checkoutNewBranch('/tmp/context', 'nao/change')).toThrowError(
			expect.objectContaining({ operation: 'checkout' }),
		);
	});

	it.each([
		['add', 0],
		['status', 1],
		['commit', 2],
	] as const)('labels batch %s failures accurately', (operation, failureIndex) => {
		mocks.execFileSync.mockReset();
		mocks.execFileSync.mockImplementation(() => {
			const callIndex = mocks.execFileSync.mock.calls.length - 1;
			if (callIndex === failureIndex) {
				throw processError(`${operation} failed`);
			}
			return callIndex === 1 ? Buffer.from(' M RULES.md') : Buffer.from('');
		});

		expect(() =>
			commitAll('/tmp/context', {
				message: 'Update context',
				author: { name: 'User', email: 'user@example.com' },
			}),
		).toThrowError(expect.objectContaining({ operation }));
	});

	it('labels generic push failures as push', () => {
		mocks.spawnSync.mockReturnValueOnce({
			error: undefined,
			status: 1,
			signal: null,
			stdout: '',
			stderr: 'push failed',
		});

		let error: unknown;
		try {
			GENERIC_GIT_PROVIDER.pushBranch({
				token: 'token',
				repoFullName: 'https://example.com/nao/context.git',
				dir: '/tmp/context',
				branch: 'nao/change',
			});
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(GitOperationError);
		expect(error).toMatchObject({ operation: 'push' });
	});
});

function processError(message: string): Error & { stderr: string } {
	return Object.assign(new Error(message), { stderr: message });
}
