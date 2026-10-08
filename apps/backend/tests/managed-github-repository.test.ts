import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	execFile: vi.fn(),
	execFileSync: vi.fn(),
	createPrivateKey: vi.fn(),
	sign: vi.fn(),
}));

vi.mock('../src/env', () => ({ env: mocks.env }));
vi.mock('node:child_process', () => ({
	execFile: mocks.execFile,
	execFileSync: mocks.execFileSync,
}));
vi.mock('node:crypto', () => ({ createPrivateKey: mocks.createPrivateKey }));
vi.mock('jose', () => ({
	SignJWT: class {
		setProtectedHeader(): this {
			return this;
		}

		setIssuer(): this {
			return this;
		}

		setIssuedAt(): this {
			return this;
		}

		setExpirationTime(): this {
			return this;
		}

		sign = mocks.sign;
	},
}));

import { provisionManagedGithubRepository } from '../src/services/managed-github-repository';

type GitExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const project = {
	projectId: '12345678-abcd-efgh-ijkl-123456789012',
	projectName: 'Lumen Bike Share',
	projectDir: '/projects/12345678',
};

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(mocks.env)) {
		delete mocks.env[key];
	}

	Object.assign(mocks.env, {
		NAO_MODE: 'self-hosted',
		CLOUD_GITHUB_PROJECT_ORG: 'nao-org',
		CLOUD_GITHUB_PROJECT_APP_ID: '123',
		CLOUD_GITHUB_PROJECT_INSTALLATION_ID: '456',
		CLOUD_GITHUB_PROJECT_PRIVATE_KEY: 'private\\nkey',
	});

	mocks.createPrivateKey.mockReturnValue({ type: 'private' });
	mocks.sign.mockResolvedValue('app-jwt');
	mocks.execFile.mockImplementation(
		(_command: string, args: string[], _options: unknown, callback: GitExecCallback) => {
			if (args[0] === 'diff') {
				callback(null, 'nao_config.yaml\n', '');
				return;
			}
			callback(null, '', '');
		},
	);
	vi.stubGlobal('fetch', vi.fn());
});

describe('managed GitHub repository provisioning', () => {
	it('does nothing when managed GitHub is not configured', async () => {
		for (const key of Object.keys(mocks.env)) {
			delete mocks.env[key];
		}

		await expect(provisionManagedGithubRepository(project)).resolves.toBeNull();
		expect(fetch).not.toHaveBeenCalled();
		expect(mocks.execFile).not.toHaveBeenCalled();
	});

	it('rejects missing managed GitHub configuration in cloud mode', async () => {
		for (const key of Object.keys(mocks.env)) {
			delete mocks.env[key];
		}
		mocks.env.NAO_MODE = 'cloud';

		await expect(provisionManagedGithubRepository(project)).rejects.toThrow(
			'Managed GitHub project configuration is required in cloud mode',
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects partial managed GitHub configuration', async () => {
		for (const key of Object.keys(mocks.env)) {
			delete mocks.env[key];
		}
		mocks.env.CLOUD_GITHUB_PROJECT_ORG = 'nao-org';

		await expect(provisionManagedGithubRepository(project)).rejects.toThrow(
			'Missing required GitHub project configuration',
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('reuses an existing repository and pushes without exposing the token in Git arguments', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockResolvedValueOnce(jsonResponse(201, { token: 'installation-token' })).mockResolvedValueOnce(
			jsonResponse(200, {
				full_name: 'nao-org/nao-lumen-bike-share-12345678',
				html_url: 'https://github.com/nao-org/nao-lumen-bike-share-12345678',
			}),
		);

		await expect(provisionManagedGithubRepository(project)).resolves.toEqual({
			repoFullName: 'nao-org/nao-lumen-bike-share-12345678',
			url: 'https://github.com/nao-org/nao-lumen-bike-share-12345678',
			created: false,
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(mocks.createPrivateKey).toHaveBeenCalledWith('private\nkey');
		expect(mocks.execFile).toHaveBeenCalledWith(
			'git',
			['remote', 'set-url', 'origin', 'https://github.com/nao-org/nao-lumen-bike-share-12345678.git'],
			expect.any(Object),
			expect.any(Function),
		);
		expect(mocks.execFile).toHaveBeenCalledWith(
			'git',
			['push', 'https://github.com/nao-org/nao-lumen-bike-share-12345678.git', 'HEAD:refs/heads/main'],
			expect.any(Object),
			expect.any(Function),
		);
	});

	it('rejects an empty repository before pushing an unborn HEAD', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockResolvedValueOnce(jsonResponse(201, { token: 'installation-token' })).mockResolvedValueOnce(
			jsonResponse(200, {
				full_name: 'nao-org/nao-lumen-bike-share-12345678',
				html_url: 'https://github.com/nao-org/nao-lumen-bike-share-12345678',
			}),
		);
		mocks.execFile.mockImplementation(
			(_command: string, args: string[], _options: unknown, callback: GitExecCallback) => {
				if (args[0] === 'rev-parse') {
					callback(new Error('unknown revision'), '', '');
					return;
				}
				callback(null, '', '');
			},
		);

		await expect(provisionManagedGithubRepository(project)).rejects.toThrow(
			'Cannot publish project: no files to commit',
		);
		expect(mocks.execFile).not.toHaveBeenCalledWith(
			'git',
			expect.arrayContaining(['push']),
			expect.any(Object),
			expect.any(Function),
		);
	});

	it('pushes an existing commit when there are no staged changes', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockResolvedValueOnce(jsonResponse(201, { token: 'installation-token' })).mockResolvedValueOnce(
			jsonResponse(200, {
				full_name: 'nao-org/nao-lumen-bike-share-12345678',
				html_url: 'https://github.com/nao-org/nao-lumen-bike-share-12345678',
			}),
		);
		mocks.execFile.mockImplementation(
			(_command: string, args: string[], _options: unknown, callback: GitExecCallback) => {
				callback(null, args[0] === 'rev-parse' ? 'abc123\n' : '', '');
			},
		);

		await expect(provisionManagedGithubRepository(project)).resolves.toEqual({
			repoFullName: 'nao-org/nao-lumen-bike-share-12345678',
			url: 'https://github.com/nao-org/nao-lumen-bike-share-12345678',
			created: false,
		});
		expect(mocks.execFile).toHaveBeenCalledWith(
			'git',
			['push', 'https://github.com/nao-org/nao-lumen-bike-share-12345678.git', 'HEAD:refs/heads/main'],
			expect.any(Object),
			expect.any(Function),
		);
	});

	it('creates a missing repository as private and without an initial commit', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock
			.mockResolvedValueOnce(jsonResponse(201, { token: 'installation-token' }))
			.mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }))
			.mockResolvedValueOnce(
				jsonResponse(201, {
					full_name: 'nao-org/nao-lumen-bike-share-12345678',
					html_url: 'https://github.com/nao-org/nao-lumen-bike-share-12345678',
				}),
			);

		await provisionManagedGithubRepository(project);

		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			'https://api.github.com/orgs/nao-org/repos',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					name: 'nao-lumen-bike-share-12345678',
					private: true,
					auto_init: false,
					description: 'nao managed analytics project',
				}),
			}),
		);
	});

	it('retries an authentication failure with a fresh installation token', async () => {
		vi.useFakeTimers();
		const fetchMock = vi.mocked(fetch);
		fetchMock
			.mockResolvedValueOnce(jsonResponse(201, { token: 'first-token' }))
			.mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }))
			.mockResolvedValueOnce(
				jsonResponse(201, {
					full_name: 'nao-org/nao-lumen-bike-share-12345678',
					html_url: 'https://github.com/nao-org/nao-lumen-bike-share-12345678',
				}),
			)
			.mockResolvedValueOnce(jsonResponse(201, { token: 'refreshed-token' }));
		let pushAttempts = 0;
		mocks.execFile.mockImplementation(
			(_command: string, args: string[], _options: unknown, callback: GitExecCallback) => {
				if (args[0] === 'diff') {
					callback(null, 'nao_config.yaml\n', '');
					return;
				}
				if (args[0] === 'push' && ++pushAttempts === 1) {
					callback(
						new Error('push failed'),
						'',
						'remote: Invalid username or token.\nfatal: Authentication failed',
					);
					return;
				}
				callback(null, '', '');
			},
		);

		try {
			const provisioning = provisionManagedGithubRepository(project);
			await vi.advanceTimersByTimeAsync(1_000);

			await expect(provisioning).resolves.toEqual({
				repoFullName: 'nao-org/nao-lumen-bike-share-12345678',
				url: 'https://github.com/nao-org/nao-lumen-bike-share-12345678',
				created: true,
			});
			expect(pushAttempts).toBe(2);
			expect(fetchMock).toHaveBeenNthCalledWith(
				4,
				'https://api.github.com/app/installations/456/access_tokens',
				expect.objectContaining({ method: 'POST' }),
			);
			expect(mocks.execFile).toHaveBeenLastCalledWith(
				'git',
				['push', 'https://github.com/nao-org/nao-lumen-bike-share-12345678.git', 'HEAD:refs/heads/main'],
				expect.objectContaining({
					env: expect.objectContaining({ NAO_GIT_TOKEN: 'refreshed-token' }),
				}),
				expect.any(Function),
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it('uses the refreshed token to delete a new repository when the retry fails', async () => {
		vi.useFakeTimers();
		const fetchMock = vi.mocked(fetch);
		fetchMock
			.mockResolvedValueOnce(jsonResponse(201, { token: 'first-token' }))
			.mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }))
			.mockResolvedValueOnce(
				jsonResponse(201, {
					full_name: 'nao-org/nao-lumen-bike-share-12345678',
					html_url: 'https://github.com/nao-org/nao-lumen-bike-share-12345678',
				}),
			)
			.mockResolvedValueOnce(jsonResponse(201, { token: 'refreshed-token' }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		let pushAttempts = 0;
		mocks.execFile.mockImplementation(
			(_command: string, args: string[], _options: unknown, callback: GitExecCallback) => {
				if (args[0] === 'diff') {
					callback(null, 'nao_config.yaml\n', '');
					return;
				}
				if (args[0] === 'push') {
					pushAttempts++;
					callback(
						new Error('push failed'),
						'',
						pushAttempts === 1 ? 'remote: Invalid username or token.' : 'retry failed',
					);
					return;
				}
				callback(null, '', '');
			},
		);

		try {
			const provisioning = provisionManagedGithubRepository(project);
			const rejection = expect(provisioning).rejects.toThrow('retry failed');
			await vi.advanceTimersByTimeAsync(1_000);

			await rejection;
			expect(fetchMock).toHaveBeenNthCalledWith(
				5,
				'https://api.github.com/repos/nao-org/nao-lumen-bike-share-12345678',
				expect.objectContaining({
					method: 'DELETE',
					headers: expect.objectContaining({ Authorization: 'Bearer refreshed-token' }),
				}),
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it('deletes a newly created repository when publishing fails', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock
			.mockResolvedValueOnce(jsonResponse(201, { token: 'installation-token' }))
			.mockResolvedValueOnce(jsonResponse(404, { message: 'Not Found' }))
			.mockResolvedValueOnce(
				jsonResponse(201, {
					full_name: 'nao-org/nao-lumen-bike-share-12345678',
					html_url: 'https://github.com/nao-org/nao-lumen-bike-share-12345678',
				}),
			)
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		mocks.execFile.mockImplementation(
			(_command: string, args: string[], _options: unknown, callback: GitExecCallback) => {
				if (args[0] === 'diff') {
					callback(null, 'nao_config.yaml\n', '');
					return;
				}
				if (args[0] === 'push') {
					callback(new Error('push failed'), '', 'push failed');
					return;
				}
				callback(null, '', '');
			},
		);

		await expect(provisionManagedGithubRepository(project)).rejects.toThrow('push failed');
		expect(fetchMock).toHaveBeenNthCalledWith(
			4,
			'https://api.github.com/repos/nao-org/nao-lumen-bike-share-12345678',
			expect.objectContaining({ method: 'DELETE' }),
		);
	});

	it('preserves an existing repository when publishing fails', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockResolvedValueOnce(jsonResponse(201, { token: 'installation-token' })).mockResolvedValueOnce(
			jsonResponse(200, {
				full_name: 'nao-org/nao-lumen-bike-share-12345678',
				html_url: 'https://github.com/nao-org/nao-lumen-bike-share-12345678',
			}),
		);
		mocks.execFile.mockImplementation(
			(_command: string, args: string[], _options: unknown, callback: GitExecCallback) => {
				if (args[0] === 'diff') {
					callback(null, 'nao_config.yaml\n', '');
					return;
				}
				if (args[0] === 'push') {
					callback(new Error('push failed'), '', 'push failed');
					return;
				}
				callback(null, '', '');
			},
		);

		await expect(provisionManagedGithubRepository(project)).rejects.toThrow('push failed');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('refuses to commit environment files', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockResolvedValueOnce(jsonResponse(201, { token: 'installation-token' })).mockResolvedValueOnce(
			jsonResponse(200, {
				full_name: 'nao-org/nao-lumen-bike-share-12345678',
				html_url: 'https://github.com/nao-org/nao-lumen-bike-share-12345678',
			}),
		);
		mocks.execFile.mockImplementation(
			(_command: string, args: string[], _options: unknown, callback: GitExecCallback) => {
				if (args[0] === 'diff') {
					callback(null, '.env\nconfig/.env.local\nnao_config.yaml\n', '');
					return;
				}
				callback(null, '', '');
			},
		);

		await expect(provisionManagedGithubRepository(project)).rejects.toThrow(
			'Refusing to commit secret files: .env, config/.env.local',
		);
		expect(mocks.execFile).not.toHaveBeenCalledWith(
			'git',
			expect.arrayContaining(['push']),
			expect.any(Object),
			expect.any(Function),
		);
	});
});

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
