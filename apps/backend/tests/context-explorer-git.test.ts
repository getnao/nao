import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
	process.env.NAO_DEFAULT_PROJECT_PATH = '';
	delete process.env.NAO_CONTEXT_SOURCE;
	delete process.env.NAO_CONTEXT_GIT_URL;
	delete process.env.NAO_CONTEXT_GIT_BRANCH;
	delete process.env.NAO_CONTEXT_GIT_SUBPATH;
	delete process.env.NAO_CONTEXT_GIT_TOKEN;
	delete process.env.NAO_CONTEXT_GIT_SSH_KEY;
	delete process.env.NAO_CONTEXT_GIT_PLATFORM;
});

const branchOwnershipMocks = vi.hoisted(() => {
	const owners = new Map<string, string>();
	const reviewRequests = new Map<string, { kind: 'created' | 'link'; url: string }>();
	return {
		owners,
		reviewRequests,
		claimContextBranch: vi.fn(async (projectId: string, branch: string, userId: string) => {
			const key = `${projectId}:${branch}`;
			if (owners.has(key)) {
				return false;
			}
			owners.set(key, userId);
			return true;
		}),
		releaseContextBranch: vi.fn(async (projectId: string, branch: string, userId: string) => {
			const key = `${projectId}:${branch}`;
			if (owners.get(key) === userId) {
				owners.delete(key);
			}
		}),
		getOwnedContextBranches: vi.fn(async (projectId: string, userId: string) => {
			return new Set(
				[...owners]
					.filter(([key, owner]) => key.startsWith(`${projectId}:`) && owner === userId)
					.map(([key]) => key.slice(projectId.length + 1)),
			);
		}),
		isContextBranchOwnedByUser: vi.fn(async (projectId: string, branch: string, userId: string) => {
			return owners.get(`${projectId}:${branch}`) === userId;
		}),
		getContextBranchReviewRequest: vi.fn(async (projectId: string, branch: string, userId: string) => {
			return reviewRequests.get(`${projectId}:${branch}:${userId}`) ?? null;
		}),
		setContextBranchReviewRequest: vi.fn(
			async (
				projectId: string,
				branch: string,
				userId: string,
				reviewRequest: { kind: 'created' | 'link'; url: string },
			) => {
				reviewRequests.set(`${projectId}:${branch}:${userId}`, reviewRequest);
			},
		),
	};
});

const contextConfigMocks = vi.hoisted(() => ({
	getConfig: vi.fn(),
	updateConfig: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
	warn: vi.fn(),
}));

vi.mock('../src/queries/context-branch-ownership.queries', () => branchOwnershipMocks);
vi.mock('../src/queries/context-recommendation.queries', () => contextConfigMocks);
vi.mock('../src/utils/logger', () => ({
	logger: {
		warn: loggerMocks.warn,
	},
	serializeError: (error: unknown) => ({
		message: error instanceof Error ? error.message : String(error),
	}),
}));

import { __reloadEnvForTesting } from '../src/env';
import { getFileTreeResponse, readFileContent, writeFileContent } from '../src/services/context-explorer.service';
import {
	assertSafeDestructiveWorktreeCommand,
	assertSafeDestructiveWorktreeTarget,
	cleanupContextWorktree,
	commitContextChanges,
	connectContextRepository,
	type ContextExplorerGitContext,
	type ContextRepositoryProvider,
	createContextBranch,
	createContextBranchAndCommit,
	discardAllContextChanges,
	discardContextFileChange,
	disconnectContextRepository,
	ensureContextWorktree,
	getChangedContextFiles,
	getContextRepositoryStatus,
	getDeploymentContextSource,
	normalizeRemote,
	resolveContextExplorerGit,
	sanitizeContextSourceRepositoryUrl,
	switchContextBranch,
} from '../src/services/context-explorer-git.service';
import { pushContextExplorerBranch } from '../src/services/context-explorer-pr.service';
import { GENERIC_GIT_PROVIDER, parseGenericRepositoryUrl, parseReviewRequestLink } from '../src/services/generic-git';
import { getContextWorktreePath, resolveContextRepository } from '../src/utils/context-repo';

describe('deployment context source', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
		contextConfigMocks.getConfig.mockResolvedValue(null);
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
		vi.unstubAllGlobals();
		branchOwnershipMocks.reviewRequests.clear();
	});

	it.each([
		['https://user:token@host/org/repo.git', 'https://host/org/repo.git'],
		['https://host/org/repo.git', 'https://host/org/repo.git'],
		['git@host:org/repo.git', 'git@host:org/repo.git'],
	])('sanitizes repository URL %s', (repositoryUrl, expected) => {
		expect(sanitizeContextSourceRepositoryUrl(repositoryUrl)).toBe(expected);
	});

	it.each([
		['ssh-key', { token: 'secret-token', sshKey: 'private-key' }],
		['token', { token: 'secret-token' }],
		['public', {}],
	] as const)('resolves %s authentication', (authMethod, credentials) => {
		setContextSourceEnv(credentials);

		expect(getDeploymentContextSource()?.authMethod).toBe(authMethod);
	});

	it('returns no context source when deployment Git mode is unset', () => {
		setContextSourceEnv({ source: null });

		expect(getDeploymentContextSource()).toBeNull();
	});

	it.each([
		['https://github.com/nao/context.git', 'github.com', 'nao/context'],
		['git@git.example.com:team/context.git', 'git.example.com', 'team/context'],
	])('derives the generic repository from %s', async (url, host, repositoryPath) => {
		setContextSourceEnv({ url, token: 'secret' });

		await expect(resolveContextRepository('project-id')).resolves.toMatchObject({
			provider: 'generic',
			repoFullName: url,
			branch: 'main',
			source: 'deployment',
		});
		expect(parseGenericRepositoryUrl(url)).toMatchObject({ host, repositoryPath });
	});

	it('prefers a connected repository over deployment Git', async () => {
		setContextSourceEnv({ token: 'secret' });
		contextConfigMocks.getConfig.mockResolvedValue({
			repoFullName: 'nao/connected-context',
			repoProvider: 'github',
		});

		await expect(resolveContextRepository('project-id')).resolves.toMatchObject({
			provider: 'github',
			repoFullName: 'nao/connected-context',
			source: 'settings',
		});
	});

	it('keeps an explicit null repository override', async () => {
		setContextSourceEnv({ token: 'secret' });

		await expect(resolveContextRepository('project-id', null)).resolves.toBeNull();
	});

	it.each([
		[{ token: 'secret-token' }, 'secret-token'],
		[{ sshKey: 'private-key' }, ''],
	] as const)('enables generic Git with deployment credentials', async (credentials, expectedToken) => {
		setContextSourceEnv(credentials);

		expect(GENERIC_GIT_PROVIDER.isIntegrationAvailable()).toBe(true);
		await expect(GENERIC_GIT_PROVIDER.getToken('user-1')).resolves.toBe(expectedToken);
	});

	it('keeps a public deployment repository read-only', async () => {
		setContextSourceEnv({});

		expect(GENERIC_GIT_PROVIDER.isIntegrationAvailable()).toBe(false);
		await expect(GENERIC_GIT_PROVIDER.getToken('user-1')).resolves.toBeNull();
	});

	it('uses x-token-auth automatically for Bitbucket Git authentication', () => {
		setContextSourceEnv({
			url: 'https://bitbucket.org/nao/context.git',
			token: 'repository-access-token',
		});

		expect(
			GENERIC_GIT_PROVIDER.authenticatedRepoUrl(
				'repository-access-token',
				'https://bitbucket.org/nao/context.git',
			),
		).toBe('https://x-token-auth:repository-access-token@bitbucket.org/nao/context.git');
	});

	it('uses bearer authentication for the Bitbucket API', async () => {
		setContextSourceEnv({
			url: 'https://bitbucket.org/nao/context.git',
			token: 'repository-access-token',
		});
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					links: { html: { href: 'https://bitbucket.org/nao/context/pull-requests/1' } },
				}),
				{ status: 201 },
			),
		);
		vi.stubGlobal('fetch', fetchMock);

		await GENERIC_GIT_PROVIDER.openReviewRequest(
			'repository-access-token',
			'https://bitbucket.org/nao/context.git',
			{
				title: 'Update context',
				head: 'nao/test',
				base: 'main',
				body: '- Update context',
				requester: { name: 'Test User', email: 'test@example.com' },
				pushOutput: '',
			},
		);

		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.bitbucket.org/2.0/repositories/nao/context/pullrequests',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer repository-access-token' }),
			}),
		);
	});

	it('uses embedded Bitbucket credentials for Git and API authentication', async () => {
		const repositoryUrl = 'https://user%40example.com:api-token@bitbucket.org/nao/context.git';
		setContextSourceEnv({
			url: repositoryUrl,
		});
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					links: { html: { href: 'https://bitbucket.org/nao/context/pull-requests/1' } },
				}),
				{ status: 201 },
			),
		);
		vi.stubGlobal('fetch', fetchMock);

		expect(GENERIC_GIT_PROVIDER.isIntegrationAvailable()).toBe(true);
		await expect(GENERIC_GIT_PROVIDER.getToken('user-1')).resolves.toBe('');
		expect(getDeploymentContextSource()?.authMethod).toBe('token');
		expect(GENERIC_GIT_PROVIDER.authenticatedRepoUrl('', repositoryUrl)).toBe(repositoryUrl);

		await GENERIC_GIT_PROVIDER.openReviewRequest('', repositoryUrl, {
			title: 'Update context',
			head: 'nao/test',
			base: 'main',
			body: '- Update context',
			requester: { name: 'Test User', email: 'test@example.com' },
			pushOutput: '',
		});

		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.bitbucket.org/2.0/repositories/nao/context/pullrequests',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: `Basic ${Buffer.from('user@example.com:api-token').toString('base64')}`,
				}),
			}),
		);
	});

	it('skips the Bitbucket API when no API credential is available', async () => {
		const reviewLink = 'https://bitbucket.org/nao/context/pull-requests/new?source=nao/test';
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			GENERIC_GIT_PROVIDER.openReviewRequest('', 'git@bitbucket.org:nao/context.git', {
				title: 'Update context',
				head: 'nao/test',
				base: 'main',
				body: '- Update context',
				requester: { name: 'Test User', email: 'test@example.com' },
				pushOutput: `remote: Create pull request:\nremote:   ${reviewLink}`,
			}),
		).resolves.toEqual({ kind: 'link', url: reviewLink });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('discovers and stores a Bitbucket pull request before using the saved creation link', async () => {
		setContextSourceEnv({
			url: 'https://bitbucket.org/nao/context.git',
			token: 'repository-access-token',
		});
		const key = 'project-id:nao/test:user-1';
		branchOwnershipMocks.reviewRequests.set(key, {
			kind: 'link',
			url: 'https://bitbucket.org/nao/context/pull-requests/new?source=nao/test',
		});
		const created = {
			kind: 'created' as const,
			url: 'https://bitbucket.org/nao/context/pull-requests/42',
		};
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ values: [{ links: { html: { href: created.url } } }] }), { status: 200 }),
			);
		vi.stubGlobal('fetch', fetchMock);
		const args = {
			token: 'repository-access-token',
			repoFullName: 'https://bitbucket.org/nao/context.git',
			branch: 'nao/test',
			projectId: 'project-id',
			userId: 'user-1',
		};

		await expect(GENERIC_GIT_PROVIDER.findOpenReviewRequest(args)).resolves.toEqual(created);
		await expect(GENERIC_GIT_PROVIDER.findOpenReviewRequest(args)).resolves.toEqual(created);

		expect(fetchMock).toHaveBeenCalledOnce();
		const lookupUrl = new URL(fetchMock.mock.calls[0][0] as string);
		expect(lookupUrl.searchParams.get('q')).toBe('source.branch.name="nao/test"');
		expect(lookupUrl.searchParams.get('state')).toBe('OPEN');
		expect(branchOwnershipMocks.reviewRequests.get(key)).toEqual(created);
	});

	it('uses the saved review link when Bitbucket pull request lookup fails', async () => {
		setContextSourceEnv({
			url: 'https://bitbucket.org/nao/context.git',
			token: 'repository-access-token',
		});
		const stored = {
			kind: 'link' as const,
			url: 'https://bitbucket.org/nao/context/pull-requests/new?source=nao/test',
		};
		branchOwnershipMocks.reviewRequests.set('project-id:nao/test:user-1', stored);
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));

		await expect(
			GENERIC_GIT_PROVIDER.findOpenReviewRequest({
				token: 'repository-access-token',
				repoFullName: 'https://bitbucket.org/nao/context.git',
				branch: 'nao/test',
				projectId: 'project-id',
				userId: 'user-1',
			}),
		).resolves.toEqual(stored);
	});

	it.each([
		[
			'github',
			'remote: Create a pull request for nao/test by visiting:\nremote:   https://github.com/nao/context/pull/new/nao/test',
			'https://github.com/nao/context/pull/new/nao/test',
		],
		[
			'gitlab',
			'remote: View merge request for nao/test:\nremote:   https://gitlab.com/nao/context/-/merge_requests/new?merge_request[source_branch]=nao/test',
			'https://gitlab.com/nao/context/-/merge_requests/new?merge_request[source_branch]=nao/test',
		],
		[
			'bitbucket',
			'remote: Create pull request for nao/test:\nremote:   https://bitbucket.org/nao/context/pull-requests/new?source=nao/test',
			'https://bitbucket.org/nao/context/pull-requests/new?source=nao/test',
		],
		[
			'self-hosted HTTP',
			'remote: Create merge request:\nremote:   http://git.example.com/nao/context/merge_requests/new?source=nao/test',
			'http://git.example.com/nao/context/merge_requests/new?source=nao/test',
		],
	])('parses the %s review link from push output', (_platform, output, expected) => {
		expect(parseReviewRequestLink(output)).toBe(expected);
	});

	it('returns no review link when push output has none', () => {
		expect(
			parseReviewRequestLink('To github.com:nao/context.git\n * [new branch] nao/test -> nao/test'),
		).toBeNull();
	});

	it('falls back to the pushed review link when the platform API fails', async () => {
		setContextSourceEnv({ token: 'push-only-token' });
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
		const link = 'https://github.com/nao/context/pull/new/nao/test';

		await expect(
			GENERIC_GIT_PROVIDER.openReviewRequest('push-only-token', 'https://github.com/nao/context.git', {
				title: 'Update context',
				head: 'nao/test',
				base: 'main',
				body: '- Update context',
				requester: { name: 'Test User', email: 'test@example.com' },
				pushOutput: `remote: Create a pull request by visiting:\nremote:   ${link}`,
			}),
		).resolves.toEqual({ kind: 'link', url: link, apiRefused: true });
		expect(loggerMocks.warn).toHaveBeenCalledWith(
			'Git platform API could not create a review request after the branch was pushed.',
			expect.objectContaining({
				context: expect.objectContaining({
					error: { message: 'network unavailable' },
				}),
			}),
		);
	});

	it('includes context source details when no write credential is configured', async () => {
		setContextSourceEnv({
			url: 'https://github.com/nao/context.git',
			branch: 'production',
			subpath: 'projects/analytics',
		});

		const context = { ...baseContext(process.cwd()), configOverride: undefined, token: null };
		const status = await getContextRepositoryStatus(context);

		expect(status).toMatchObject({
			managedByContextSource: true,
			gitUnavailableReason: 'no-token',
			gitUnavailableMessage:
				'Add NAO_CONTEXT_GIT_TOKEN or NAO_CONTEXT_GIT_SSH_KEY to edit and propose context changes.',
			contextSource: {
				repositoryUrl: 'https://github.com/nao/context.git',
				branch: 'production',
				subpath: 'projects/analytics',
				authMethod: 'public',
			},
		});
	});

	it('allows disconnecting a connected repository during deployment Git', async () => {
		setContextSourceEnv({});
		const updateConfig = vi.fn();

		await expect(
			disconnectContextRepository(baseContext(process.cwd()), { updateConfig }),
		).resolves.toBeUndefined();
		expect(updateConfig).toHaveBeenCalledWith('project-id', {
			repoFullName: null,
			repoProvider: null,
		});
	});
});

describe('repository remote normalization', () => {
	it.each([
		['git@github.com:nao/context.git', 'https://github.com/nao/context'],
		['ssh://git@github.com:2222/nao/context.git', 'https://github.com/nao/context'],
	])('matches SSH remote %s to HTTPS', (sshRemote, httpsRemote) => {
		expect(normalizeRemote(sshRemote)).toBe(normalizeRemote(httpsRemote));
	});

	it('keeps different repositories distinct', () => {
		expect(normalizeRemote('git@github.com:nao/context.git')).not.toBe(
			normalizeRemote('https://github.com/nao/other.git'),
		);
	});

	it('ignores URL credentials and ports', () => {
		expect(normalizeRemote('https://user:token@github.com:8443/nao/context.git/')).toBe(
			normalizeRemote('https://github.com/nao/context'),
		);
	});
});

describe('context explorer worktrees', () => {
	const temporaryRoots: string[] = [];
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
		setContextSourceEnv({ source: null });
		contextConfigMocks.getConfig.mockResolvedValue(null);
		contextConfigMocks.updateConfig.mockResolvedValue(undefined);
	});

	afterEach(() => {
		for (const root of temporaryRoots.splice(0)) {
			fs.rmSync(root, { recursive: true, force: true });
		}
		branchOwnershipMocks.owners.clear();
		branchOwnershipMocks.reviewRequests.clear();
		vi.clearAllMocks();
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

	it('clones into the derived worktree and never changes the live folder', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);

		const repo = await ensureContextWorktree(fixture.context);
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'worktree edit\n', file.hash, access);

		expect(repo.worktreeRoot).toBe(path.join(fixture.root, '.nao', 'worktrees', 'project-id', 'user-1'));
		expect(file.content).toBe('repository content\n');
		expect(fs.readFileSync(path.join(repo.worktreeRoot, 'context.md'), 'utf8')).toBe('worktree edit\n');
		expectLiveUnchanged(fixture.live, before);
	});

	it('encodes unsafe user ids without escaping the project worktree directory', async () => {
		const fixture = createFixture(temporaryRoots);
		const repo = await ensureContextWorktree({ ...fixture.context, userId: '../other/user' });
		const projectWorktrees = path.join(fixture.root, '.nao', 'worktrees', 'project-id');

		expect(path.dirname(repo.worktreeRoot)).toBe(projectWorktrees);
		expect(path.basename(repo.worktreeRoot)).toBe('%2E%2E%2Fother%2Fuser');
		expect(() => assertSafeDestructiveWorktreeTarget(repo.worktreeRoot, fixture.live)).not.toThrow();
	});

	it('uses git worktree add when the live folder is inside the connected clone', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		const before = snapshot(fixture.live);

		const repo = await ensureContextWorktree(fixture.context);

		expect(repo.projectPrefix).toBe('project');
		expect(fs.readFileSync(path.join(repo.worktreeRoot, 'project', 'context.md'), 'utf8')).toBe(
			'repository content\n',
		);
		expectLiveUnchanged(fixture.live, before);
	});

	it('uses a fresh full clone and configured subpath for deployment-managed Git', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		setContextSourceEnv({
			url: 'https://github.com/nao/context.git',
			branch: 'main',
			subpath: 'project',
			token: 'deployment-token',
		});
		fixture.context.token = 'deployment-token';
		fixture.context.configOverride = undefined;

		const repo = await ensureContextWorktree(fixture.context);
		const gitDirectory = runGit(repo.worktreeRoot, ['rev-parse', '--absolute-git-dir']).toString().trim();

		expect(repo.provider).toBe('generic');
		expect(repo.projectPrefix).toBe('project');
		expect(fs.realpathSync(gitDirectory)).toBe(fs.realpathSync(path.join(repo.worktreeRoot, '.git')));
		expect(fs.readFileSync(path.join(repo.worktreeRoot, 'project', 'context.md'), 'utf8')).toBe(
			'repository content\n',
		);
	});

	it.each([
		['token', { token: 'deployment-token' }, 'deployment-token'],
		['SSH key', { sshKey: 'private-key' }, ''],
	] as const)('makes deployment-managed Git available with a %s', async (_label, credentials, token) => {
		const fixture = createFixture(temporaryRoots);
		setContextSourceEnv({ url: 'https://github.com/nao/context.git', ...credentials });
		fixture.context.token = token;
		fixture.context.configOverride = undefined;

		await expect(resolveContextExplorerGit(fixture.context)).resolves.toMatchObject({
			status: 'available',
			repo: { provider: 'generic', repoFullName: 'https://github.com/nao/context.git' },
		});
	});

	it('isolates users in detached worktrees from the same local clone', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		const secondContext = { ...fixture.context, userId: 'user-2' };

		const firstRepo = await ensureContextWorktree(fixture.context);
		const secondRepo = await ensureContextWorktree(secondContext);
		const firstAccess = await fileAccess(fixture.context);
		const secondAccess = await fileAccess(secondContext);
		const firstFile = await readFileContent('/context.md', firstAccess);
		await writeFileContent('/context.md', 'first user edit\n', firstFile.hash, firstAccess);

		expect(firstRepo.worktreeRoot).not.toBe(secondRepo.worktreeRoot);
		expect(runGit(firstRepo.worktreeRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim()).toBe('HEAD');
		expect(runGit(secondRepo.worktreeRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim()).toBe('HEAD');
		expect((await getContextRepositoryStatus(fixture.context)).branches?.currentBranch).toBe('main');
		expect((await getContextRepositoryStatus(secondContext)).branches?.currentBranch).toBe('main');
		expect((await readFileContent('/context.md', secondAccess)).content).toBe('repository content\n');
	});

	it('keeps a cloned project read-only when no repository setting exists', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		fixture.context.configOverride = undefined;
		const worktree = getContextWorktreePath('project-id', fixture.live, 'user-1');

		const access = await fileAccess(fixture.context);
		const status = await getContextRepositoryStatus(fixture.context);
		const tree = await getFileTreeResponse(access);
		const file = await readFileContent('/context.md', access);

		expect(access.git).toMatchObject({ status: 'unavailable', reason: 'no-repo', repo: null });
		expect(status).toMatchObject({ repo: null, gitUnavailableReason: 'no-repo', isGitRepository: false });
		expect(tree.entries.map((entry) => entry.name)).toContain('context.md');
		expect(file).toMatchObject({
			content: 'repository content\n',
			isEditable: false,
			reason: 'no-repo',
			guidance: {
				message: 'No context repository is connected. Connect one in Git settings to edit context files.',
				actionKind: 'route',
				actionPath: '/settings/git',
			},
		});
		await expect(writeFileContent('/context.md', 'changed\n', file.hash, access)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(fs.existsSync(worktree)).toBe(false);
	});

	it('uses an explicit override before the saved repository setting', async () => {
		contextConfigMocks.getConfig.mockResolvedValue({
			repoFullName: 'nao/saved',
			repoProvider: 'github',
		});

		await expect(
			resolveContextRepository('project-id', { provider: 'gitlab', repoFullName: 'nao/override' }),
		).resolves.toMatchObject({
			provider: 'gitlab',
			repoFullName: 'nao/override',
			source: 'settings',
		});
		await expect(resolveContextRepository('project-id', null)).resolves.toBeNull();
		expect(contextConfigMocks.getConfig).not.toHaveBeenCalled();
	});

	it('uses the saved repository setting when no override is provided', async () => {
		contextConfigMocks.getConfig.mockResolvedValue({
			repoFullName: 'nao/saved',
			repoProvider: 'gitlab',
		});

		await expect(resolveContextRepository('project-id')).resolves.toMatchObject({
			provider: 'gitlab',
			repoFullName: 'nao/saved',
			source: 'settings',
			webUrl: 'https://gitlab.com/nao/saved',
		});
	});

	it('connects the selected repository when the project clone points elsewhere', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		const selected = createFixture(temporaryRoots, {
			'nao_config.yaml': 'name: selected\n',
			'context.md': 'selected repository content\n',
		});
		const updateConfig = vi.fn().mockResolvedValue(undefined);
		setContextSourceEnv({ token: 'deployment-token' });

		const result = await connectContextRepository(
			{
				...fixture.context,
				provider: 'github',
				repoFullName: 'nao/selected',
			},
			{
				provider: localProvider(selected.bare, 'https://github.com/nao/selected.git'),
				updateConfig,
			},
		);
		const worktree = getContextWorktreePath('project-id', fixture.live, 'user-1');

		expect(result).toMatchObject({ provider: 'github', repoFullName: 'nao/selected' });
		expect(updateConfig).toHaveBeenCalledWith('project-id', {
			repoFullName: 'nao/selected',
			repoProvider: 'github',
		});
		expect(fs.readFileSync(path.join(worktree, 'context.md'), 'utf8')).toBe('selected repository content\n');
	});

	it('supports GitLab repositories below the setup boundary', async () => {
		const fixture = createFixture(temporaryRoots);
		fixture.context.configOverride = { provider: 'gitlab', repoFullName: 'nao/context' };
		fixture.context.providerOverride = localProvider(fixture.bare, 'https://gitlab.com/nao/context.git');

		const resolution = await resolveContextExplorerGit(fixture.context);

		expect(resolution).toMatchObject({
			status: 'available',
			repo: { provider: 'gitlab', repoFullName: 'nao/context' },
		});
	});

	it('names GitLab in no-token guidance', async () => {
		const fixture = createFixture(temporaryRoots);
		fixture.context.configOverride = { provider: 'gitlab', repoFullName: 'nao/context' };
		fixture.context.token = null;
		const access = await fileAccess(fixture.context);

		await expect(readFileContent('/context.md', access)).resolves.toMatchObject({
			reason: 'no-token',
			guidance: {
				message: 'Connect your GitLab account before using Git actions in the context explorer.',
				actionLabel: 'Connect GitLab account',
			},
		});
	});

	it('names GitLab when its integration is unavailable', async () => {
		const fixture = createFixture(temporaryRoots);
		fixture.context.configOverride = { provider: 'gitlab', repoFullName: 'nao/context' };
		fixture.context.integrationAvailableOverride = false;
		const access = await fileAccess(fixture.context);

		await expect(readFileContent('/context.md', access)).resolves.toMatchObject({
			reason: 'github-unavailable',
			guidance: {
				message: 'GitLab is not configured for this instance. Add the GitLab client credentials first.',
			},
		});
	});

	it('self-heals a missing worktree', async () => {
		const fixture = createFixture(temporaryRoots);
		const first = await ensureContextWorktree(fixture.context);
		fs.rmSync(first.worktreeRoot, { recursive: true, force: true });

		const second = await ensureContextWorktree(fixture.context);

		expect(fs.readFileSync(path.join(second.worktreeRoot, 'context.md'), 'utf8')).toBe('repository content\n');
	});

	it('repairs a missing linked worktree through the allowed management flow', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		const first = await ensureContextWorktree(fixture.context);
		fs.rmSync(first.worktreeRoot, { recursive: true, force: true });

		const second = await ensureContextWorktree(fixture.context);

		expect(fs.readFileSync(path.join(second.worktreeRoot, 'project', 'context.md'), 'utf8')).toBe(
			'repository content\n',
		);
	});

	it('removes a user worktree and prunes its Git registration', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		const repo = await ensureContextWorktree(fixture.context);
		const repositoryRoot = runGit(fixture.live, ['rev-parse', '--show-toplevel']).toString().trim();

		await cleanupContextWorktree(fixture.context.projectId, fixture.context.projectFolder, fixture.context.userId);

		expect(fs.existsSync(repo.worktreeRoot)).toBe(false);
		expect(runGit(repositoryRoot, ['worktree', 'list', '--porcelain']).toString()).not.toContain(repo.worktreeRoot);
	});

	it('falls back to deployment Git after disconnecting a cloned project', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		setContextSourceEnv({ url: fixture.bare, sshKey: 'deployment-key', platform: 'gitlab' });
		fixture.context.configOverride = undefined;
		let connected = true;
		contextConfigMocks.getConfig.mockImplementation(async () =>
			connected ? { repoFullName: 'nao/context', repoProvider: 'github' } : null,
		);
		const repo = await ensureContextWorktree(fixture.context);
		const updateConfig = vi.fn().mockImplementation(async () => {
			connected = false;
		});

		await disconnectContextRepository(fixture.context, { updateConfig });
		expect(fs.existsSync(repo.worktreeRoot)).toBe(false);
		const status = await getContextRepositoryStatus(fixture.context);
		const access = await fileAccess(fixture.context);

		expect(updateConfig).toHaveBeenCalledWith('project-id', {
			repoFullName: null,
			repoProvider: null,
		});
		expect(status).toMatchObject({
			repo: { provider: 'generic', platform: 'gitlab', repoFullName: fixture.bare },
			gitUnavailableReason: null,
			isGitRepository: true,
		});
		expect(access.git).toMatchObject({ status: 'available', repo: { provider: 'generic' } });
	});

	it('creates a branch and commits selected dirty files while leaving others uncommitted', async () => {
		const fixture = createFixture(temporaryRoots, {
			'nao_config.yaml': 'name: test\n',
			'context.md': 'repository content\n',
			'other.md': 'other\n',
		});
		const before = snapshot(fixture.live);
		const access = await fileAccess(fixture.context);
		const contextFile = await readFileContent('/context.md', access);
		const otherFile = await readFileContent('/other.md', access);
		await writeFileContent('/context.md', 'selected\n', contextFile.hash, access);
		await writeFileContent('/other.md', 'unselected\n', otherFile.hash, access);

		const result = await createContextBranchAndCommit(fixture.context, {
			paths: ['/context.md'],
			message: 'Update context',
		});
		const changed = await getChangedContextFiles(fixture.context);

		expect(result.branch).toMatch(/^nao\/context-edits-[a-z0-9]+$/);
		expect(result.baseUsed).toBe('origin/main');
		expect(result.usedFallbackBase).toBe(false);
		expect(branchOwnershipMocks.claimContextBranch).toHaveBeenCalledWith('project-id', result.branch, 'user-1');
		expect(changed).toEqual([{ path: '/other.md', kind: 'modified', additions: 1, deletions: 1 }]);
		expect(
			runGit(path.join(fixture.root, '.nao', 'worktrees', 'project-id', 'user-1'), [
				'show',
				'HEAD:context.md',
			]).toString(),
		).toBe('selected\n');
		expectLiveUnchanged(fixture.live, before);
	});

	it('uses the logged-in nao user as the commit identity', async () => {
		const fixture = createFixture(temporaryRoots);
		fixture.context.user = { name: 'Nao Account', email: 'nao-account@example.com' };
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'identity edit\n', file.hash, access);

		await createContextBranchAndCommit(fixture.context, {
			paths: ['/context.md'],
			message: 'Use account identity',
		});
		const repo = await ensureContextWorktree(fixture.context);

		expect(runGit(repo.worktreeRoot, ['log', '-1', '--format=%an <%ae>|%cn <%ce>']).toString().trim()).toBe(
			'Nao Account <nao-account@example.com>|Nao Account <nao-account@example.com>',
		);
	});

	it('rejects commits until an owned branch is checked out', async () => {
		const fixture = createFixture(temporaryRoots);
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'default branch edit\n', file.hash, access);
		const repo = await ensureContextWorktree(fixture.context);
		const head = runGit(repo.worktreeRoot, ['rev-parse', 'HEAD']).toString().trim();

		await expect(
			commitContextChanges(fixture.context, {
				paths: ['/context.md'],
				message: 'Unreachable commit',
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Create a branch before committing context changes.',
		});

		expect(runGit(repo.worktreeRoot, ['rev-parse', 'HEAD']).toString().trim()).toBe(head);
		expect(await getChangedContextFiles(fixture.context)).toHaveLength(1);
	});

	it('reports commits that have not been pushed to the current branch', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);

		const defaultStatus = await getContextRepositoryStatus(fixture.context);
		expect(defaultStatus.branches).toMatchObject({
			aheadCommitCount: 0,
			unpushedCommitCount: 0,
		});

		await createContextBranch(fixture.context, 'nao/empty');
		const emptyBranchStatus = await getContextRepositoryStatus(fixture.context);
		expect(emptyBranchStatus.branches).toMatchObject({
			currentBranch: 'nao/empty',
			defaultBranch: 'main',
			aheadCommitCount: 0,
			unpushedCommitCount: 0,
		});

		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'committed branch edit\n', file.hash, access);
		await commitContextChanges(fixture.context, {
			paths: ['/context.md'],
			message: 'Commit branch edit',
		});

		const committedBranchStatus = await getContextRepositoryStatus(fixture.context);
		expect(committedBranchStatus.branches).toMatchObject({
			aheadCommitCount: 1,
			unpushedCommitCount: 1,
		});

		await pushContextExplorerBranch(fixture.context);
		const pushedBranchStatus = await getContextRepositoryStatus(fixture.context);
		expect(pushedBranchStatus.branches).toMatchObject({
			aheadCommitCount: 1,
			unpushedCommitCount: 0,
		});

		const pushedFile = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'another branch edit\n', pushedFile.hash, access);
		await commitContextChanges(fixture.context, {
			paths: ['/context.md'],
			message: 'Commit another edit',
		});
		const newCommitStatus = await getContextRepositoryStatus(fixture.context);
		expect(newCommitStatus.branches?.unpushedCommitCount).toBe(1);
		expectLiveUnchanged(fixture.live, before);
	});

	it('shows only the default branch and branches owned by the current user', async () => {
		const fixture = createFixture(temporaryRoots);
		const repo = await ensureContextWorktree(fixture.context);
		runGit(repo.worktreeRoot, ['update-ref', 'refs/remotes/origin/owned', 'HEAD']);
		runGit(repo.worktreeRoot, ['update-ref', 'refs/remotes/origin/colleague', 'HEAD']);
		runGit(repo.worktreeRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
		branchOwnershipMocks.owners.set('project-id:owned', 'user-1');
		branchOwnershipMocks.owners.set('project-id:colleague', 'user-2');

		const status = await getContextRepositoryStatus(fixture.context);

		expect(status.branches?.branches).toEqual(['main', 'owned']);
		expect(status.branches?.branches).not.toContain('origin');
	});

	it('rejects switching to a branch owned by another user', async () => {
		const fixture = createFixture(temporaryRoots);
		const repo = await ensureContextWorktree(fixture.context);
		runGit(repo.worktreeRoot, ['branch', 'colleague']);
		branchOwnershipMocks.owners.set('project-id:colleague', 'user-2');

		await expect(switchContextBranch(fixture.context, 'colleague')).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
	});

	it('returns an unavailable status when git is unavailable or no repository is connected', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);
		await ensureContextWorktree(fixture.context);
		const originalPath = process.env.PATH;

		try {
			process.env.PATH = '';
			await expect(getContextRepositoryStatus(fixture.context)).resolves.toMatchObject({
				gitUnavailableReason: 'git-unavailable',
				branches: null,
			});
			await expect(getChangedContextFiles(fixture.context)).resolves.toEqual([]);
		} finally {
			process.env.PATH = originalPath;
		}

		const disconnectedContext = { ...fixture.context, configOverride: null };
		await expect(getContextRepositoryStatus(disconnectedContext)).resolves.toMatchObject({
			gitUnavailableReason: 'no-repo',
			branches: null,
		});
		await expect(getChangedContextFiles(disconnectedContext)).resolves.toEqual([]);
		expectLiveUnchanged(fixture.live, before);
	});

	it('reports line changes for tracked, untracked, and binary files without changing the live folder', async () => {
		const fixture = createFixture(temporaryRoots, {
			'nao_config.yaml': 'name: test\n',
			'context.md': 'repository content\n',
			'binary.dat': 'plain text\n',
		});
		const before = snapshot(fixture.live);
		const repo = await ensureContextWorktree(fixture.context);
		fs.writeFileSync(path.join(repo.worktreeRoot, 'context.md'), 'replacement\nextra\n');
		fs.writeFileSync(path.join(repo.worktreeRoot, 'new.md'), 'first\nsecond\n');
		fs.writeFileSync(path.join(repo.worktreeRoot, 'binary.dat'), Buffer.from([0, 1, 2, 3]));

		await expect(getChangedContextFiles(fixture.context)).resolves.toEqual([
			{ path: '/binary.dat', kind: 'modified', additions: null, deletions: null },
			{ path: '/context.md', kind: 'modified', additions: 2, deletions: 1 },
			{ path: '/new.md', kind: 'untracked', additions: 2, deletions: 0 },
		]);
		expectLiveUnchanged(fixture.live, before);
	});

	it('falls back to the current HEAD when the fetched default cannot accept dirty edits', async () => {
		const fixture = createFixture(temporaryRoots);
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'local edit\n', file.hash, access);
		const repo = await ensureContextWorktree(fixture.context);
		writeRemoteChange(fixture, 'context.md', 'remote edit\n');

		const result = await createContextBranchAndCommit(fixture.context, {
			branch: 'nao/fallback',
			paths: ['/context.md'],
			message: 'Keep local edit',
		});

		expect(result.usedFallbackBase).toBe(true);
		expect(result.baseUsed).toMatch(/^[a-f0-9]{40}$/);
		expect(runGit(repo.worktreeRoot, ['show', 'HEAD:context.md']).toString()).toBe('local edit\n');
	});

	it('creates a branch from the current HEAD when the fetched default cannot accept dirty edits', async () => {
		const fixture = createFixture(temporaryRoots);
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'local edit\n', file.hash, access);
		const repo = await ensureContextWorktree(fixture.context);
		writeRemoteChange(fixture, 'context.md', 'remote edit\n');

		const result = await createContextBranch(fixture.context, 'nao/fallback-without-commit');

		expect(result.usedFallbackBase).toBe(true);
		expect(result.currentBranch).toBe('nao/fallback-without-commit');
		expect(fs.readFileSync(path.join(repo.worktreeRoot, 'context.md'), 'utf8')).toBe('local edit\n');
		expect(await getChangedContextFiles(fixture.context)).toEqual([
			{ path: '/context.md', kind: 'modified', additions: 1, deletions: 1 },
		]);
	});

	it('releases branch ownership when branch creation fails', async () => {
		const fixture = createFixture(temporaryRoots);
		const repo = await ensureContextWorktree(fixture.context);
		const indexLockPath = path.resolve(
			repo.worktreeRoot,
			runGit(repo.worktreeRoot, ['rev-parse', '--git-path', 'index.lock']).toString().trim(),
		);
		fs.writeFileSync(indexLockPath, 'locked');

		await expect(createContextBranch(fixture.context, 'nao/failed')).rejects.toThrow();

		expect(branchOwnershipMocks.releaseContextBranch).toHaveBeenCalledWith('project-id', 'nao/failed', 'user-1');
		expect(branchOwnershipMocks.owners.has('project-id:nao/failed')).toBe(false);
	});

	it('commits selected files, then pushes and opens a pull request', async () => {
		const fixture = createFixture(temporaryRoots);
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'pull request edit\n', file.hash, access);

		const commit = await createContextBranchAndCommit(fixture.context, {
			paths: ['/context.md'],
			message: 'Update shared context',
		});
		const result = await pushContextExplorerBranch(fixture.context);

		expect(result).toEqual({
			branch: commit.branch,
			reviewRequest: { kind: 'created', url: 'https://github.com/nao/context/pull/1' },
		});
		expect(
			runGit(fixture.root, ['--git-dir', fixture.bare, 'show', `${result.branch}:context.md`]).toString(),
		).toBe('pull request edit\n');
	});

	it.each([
		{
			name: 'branch name collision',
			error: "Command failed: git push https://x-access-token:test-token@github.com/ad4mou/context-files-tes.git HEAD:refs/heads/adam To https://github.com/ad4mou/context-files-tes.git ! [remote rejected] HEAD -> adam (cannot lock ref 'refs/heads/adam': 'refs/heads/adam/context' exists; cannot create 'refs/heads/adam') error: failed to push some refs to 'https://github.com/ad4mou/context-files-tes.git'",
			expected:
				'The branch name "adam" can\'t be used because "adam/context" already exists; choose a different branch name.',
		},
		{
			name: 'remote branch changed',
			error: 'error: failed to push some refs\nhint: Updates were rejected because the tip is non-fast-forward',
			expected:
				'The branch changed on the remote repository since nao last checked it, so refresh and try again.',
		},
		{
			name: 'protected branch',
			error: 'remote: error: GH006: Protected branch update failed\npre-receive hook declined',
			expected:
				'The remote repository refused this push because a branch protection rule blocks changes to this branch.',
		},
		{
			name: 'credential rejected',
			error: 'fatal: unable to access repository: The requested URL returned error: 403',
			expected:
				'The repository rejected the configured Git credential; check that the token or SSH key is valid and has access.',
		},
		{
			name: 'repository not found',
			error: 'remote: Repository not found.\nfatal: repository returned error: 404',
			expected: 'This repository does not exist or the configured Git credential cannot access it.',
		},
		{
			name: 'unrecognised failure',
			error: 'Unexpected git failure for test-token',
			expected: 'Unexpected git failure for [redacted]',
		},
	])('shows a safe message for $name', async ({ error, expected }) => {
		const fixture = createFixture(temporaryRoots);
		const provider = fixture.context.providerOverride;
		if (!provider) {
			throw new Error('Expected a local provider.');
		}
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'failed push edit\n', file.hash, access);
		await createContextBranchAndCommit(fixture.context, {
			paths: ['/context.md'],
			message: 'Prepare failed push',
		});
		vi.spyOn(provider, 'pushBranch').mockImplementation(() => {
			throw new Error(error);
		});

		await expect(pushContextExplorerBranch(fixture.context)).rejects.toThrow(expected);
	});

	it('switches clean existing branches and discards one or all changed paths', async () => {
		const fixture = createFixture(temporaryRoots, {
			'nao_config.yaml': 'name: test\n',
			'context.md': 'repository content\n',
			'other.md': 'other\n',
		});
		const before = snapshot(fixture.live);
		const repo = await ensureContextWorktree(fixture.context);
		runGit(repo.worktreeRoot, ['branch', 'review']);
		branchOwnershipMocks.owners.set('project-id:review', 'user-1');
		await switchContextBranch(fixture.context, 'review');
		const access = await fileAccess(fixture.context);
		const first = await readFileContent('/context.md', access);
		const second = await readFileContent('/other.md', access);
		await writeFileContent('/context.md', 'first edit\n', first.hash, access);
		await writeFileContent('/other.md', 'second edit\n', second.hash, access);

		await discardContextFileChange(fixture.context, '/context.md');
		expect(await getChangedContextFiles(fixture.context)).toEqual([
			{ path: '/other.md', kind: 'modified', additions: 1, deletions: 1 },
		]);
		await discardAllContextChanges(fixture.context);
		expect(await getChangedContextFiles(fixture.context)).toEqual([]);
		expectLiveUnchanged(fixture.live, before);
	});

	it('resolves a subdirectory project and never touches a same-named root file', async () => {
		const fixture = createFixture(temporaryRoots, {
			'context.md': 'root context\n',
			'analytics/nao_config.yaml': 'name: analytics\n',
			'analytics/context.md': 'analytics repository\n',
		});
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'analytics edit\n', file.hash, access);
		const repo = await ensureContextWorktree(fixture.context);

		expect(repo.projectPrefix).toBe('analytics');
		expect(fs.readFileSync(path.join(repo.worktreeRoot, 'context.md'), 'utf8')).toBe('root context\n');
		expect(fs.readFileSync(path.join(repo.worktreeRoot, 'analytics', 'context.md'), 'utf8')).toBe(
			'analytics edit\n',
		);
	});

	it('opens a pull request from branch commit messages in oldest-first order', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);
		const provider = fixture.context.providerOverride;
		if (!provider) {
			throw new Error('Expected a local provider.');
		}
		const openReviewRequest = vi.spyOn(provider, 'openReviewRequest');
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'separately committed\n', file.hash, access);
		const committed = await createContextBranchAndCommit(fixture.context, {
			paths: ['/context.md'],
			message: 'Update shared context',
		});
		const committedFile = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'second committed edit\n', committedFile.hash, access);
		await commitContextChanges(fixture.context, {
			paths: ['/context.md'],
			message: 'Clarify context details',
		});

		const result = await pushContextExplorerBranch(fixture.context);

		expect(result.branch).toBe(committed.branch);
		expect(openReviewRequest).toHaveBeenCalledWith('test-token', 'nao/context', {
			title: 'Update shared context',
			body: '- Update shared context\n- Clarify context details',
			head: committed.branch,
			base: 'main',
			requester: { name: 'Test User', email: 'test@example.com' },
			pushOutput: '',
		});
		expect(
			runGit(fixture.root, ['--git-dir', fixture.bare, 'show', `${committed.branch}:context.md`]).toString(),
		).toBe('second committed edit\n');
		expectLiveUnchanged(fixture.live, before);
	});

	it('pushes commits to an existing pull request without opening another', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);
		const provider = fixture.context.providerOverride;
		if (!provider) {
			throw new Error('Expected a local provider.');
		}
		const existingPullRequest = { kind: 'created' as const, url: 'https://github.com/nao/context/pull/7' };
		vi.spyOn(provider, 'findOpenReviewRequest').mockResolvedValue(existingPullRequest);
		const openReviewRequest = vi.spyOn(provider, 'openReviewRequest');
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'existing pull request edit\n', file.hash, access);
		const committed = await createContextBranchAndCommit(fixture.context, {
			paths: ['/context.md'],
			message: 'Update existing proposal',
		});

		const result = await pushContextExplorerBranch(fixture.context);

		expect(result).toEqual({
			branch: committed.branch,
			reviewRequest: { kind: 'created', url: existingPullRequest.url },
		});
		expect(openReviewRequest).not.toHaveBeenCalled();
		expect(
			runGit(fixture.root, ['--git-dir', fixture.bare, 'show', `${committed.branch}:context.md`]).toString(),
		).toBe('existing pull request edit\n');
		expectLiveUnchanged(fixture.live, before);
	});

	it('reuses the stored review link after later pushes stop printing it', async () => {
		const fixture = createFixture(temporaryRoots);
		const provider = fixture.context.providerOverride;
		if (!provider) {
			throw new Error('Expected a local provider.');
		}
		const reviewLink = {
			kind: 'link' as const,
			url: 'https://git.example.com/nao/context/pullrequestcreate?source=nao/test',
		};
		vi.spyOn(provider, 'findOpenReviewRequest').mockImplementation(
			async ({ projectId, branch, userId }) =>
				branchOwnershipMocks.reviewRequests.get(`${projectId}:${branch}:${userId}`) ?? null,
		);
		const openReviewRequest = vi.spyOn(provider, 'openReviewRequest').mockResolvedValue(reviewLink);
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'first stored link edit\n', file.hash, access);
		const committed = await createContextBranchAndCommit(fixture.context, {
			paths: ['/context.md'],
			message: 'First stored link edit',
		});

		const firstPush = await pushContextExplorerBranch(fixture.context);
		const pushedFile = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'second stored link edit\n', pushedFile.hash, access);
		await commitContextChanges(fixture.context, {
			paths: ['/context.md'],
			message: 'Second stored link edit',
		});
		const secondPush = await pushContextExplorerBranch(fixture.context);

		expect(firstPush).toEqual({ branch: committed.branch, reviewRequest: reviewLink });
		expect(secondPush).toEqual({ branch: committed.branch, reviewRequest: reviewLink });
		expect(openReviewRequest).toHaveBeenCalledOnce();
		expect(branchOwnershipMocks.setContextBranchReviewRequest).toHaveBeenCalledWith(
			'project-id',
			committed.branch,
			'user-1',
			reviewLink,
		);
	});

	it('reports an empty branch as having nothing to push without throwing', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);
		await createContextBranch(fixture.context, 'nao/empty-proposal');

		await expect(getContextRepositoryStatus(fixture.context)).resolves.toMatchObject({
			branches: {
				currentBranch: 'nao/empty-proposal',
				aheadCommitCount: 0,
				unpushedCommitCount: 0,
			},
			openReviewRequest: null,
		});
		expectLiveUnchanged(fixture.live, before);
	});

	it('degrades missing and ambiguous projects to read-only live browsing', async () => {
		for (const files of [
			{ 'context.md': 'repository\n' },
			{ 'one/nao_config.yaml': 'one\n', 'two/nao_config.yaml': 'two\n' },
		]) {
			const fixture = createFixture(temporaryRoots, files);
			const before = snapshot(fixture.live);
			const access = await fileAccess(fixture.context);
			const tree = await getFileTreeResponse(access);
			const file = await readFileContent('/context.md', access);

			expect(access.git.status).toBe('unavailable');
			expect(tree.entries.some((entry) => entry.name === 'context.md')).toBe(true);
			expect(file.isEditable).toBe(false);
			expectLiveUnchanged(fixture.live, before);
		}
	});

	it('keeps browsing available with no repo or token while refusing mutation', async () => {
		const root = temporaryRoot(temporaryRoots);
		const live = path.join(root, 'live');
		fs.mkdirSync(live);
		fs.writeFileSync(path.join(live, 'context.md'), 'live\n');
		const contexts: ContextExplorerGitContext[] = [baseContext(live, null), { ...baseContext(live), token: null }];

		for (const context of contexts) {
			const access = await fileAccess(context);
			const file = await readFileContent('/context.md', access);
			expect(file.content).toBe('live\n');
			expect(file.isEditable).toBe(false);
			await expect(writeFileContent('/context.md', 'blocked\n', file.hash, access)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
			await expect(discardAllContextChanges(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
		}
	});

	it('rejects every unsafe destructive target, including a repository containing the live folder', () => {
		const root = temporaryRoot(temporaryRoots);
		const live = path.join(root, 'repo', 'project');
		fs.mkdirSync(live, { recursive: true });

		expect(() => assertSafeDestructiveWorktreeTarget(path.join(root, 'repo'), live)).toThrow(
			'outside a .nao/worktrees',
		);
		expect(() => assertSafeDestructiveWorktreeTarget(live, live)).toThrow();
		expect(() => assertSafeDestructiveWorktreeTarget(path.join(root, '.nao', 'worktrees'), live)).toThrow();
		expect(() => assertSafeDestructiveWorktreeTarget(path.join(root, '.nao', 'worktrees', 'safe'), live)).toThrow();
		expect(() =>
			assertSafeDestructiveWorktreeTarget(path.join(root, '.nao', 'worktrees', 'safe', 'user'), live),
		).not.toThrow();
	});

	it('allows only worktree management commands outside the asserted worktree', () => {
		const root = temporaryRoot(temporaryRoots);
		const live = path.join(root, 'live');
		const worktree = path.join(root, '.nao', 'worktrees', 'safe', 'user');

		expect(() => assertSafeDestructiveWorktreeCommand(worktree, root, ['restore', '--worktree', '.'])).toThrow(
			'outside the context worktree',
		);
		expect(() =>
			assertSafeDestructiveWorktreeCommand(worktree, root, ['worktree', 'add', '--detach', worktree, 'main']),
		).not.toThrow();
		expect(() =>
			assertSafeDestructiveWorktreeCommand(worktree, root, ['worktree', 'remove', '--force', worktree]),
		).not.toThrow();
		expect(() => assertSafeDestructiveWorktreeCommand(worktree, root, ['worktree', 'prune'])).not.toThrow();
		expect(fs.existsSync(live)).toBe(false);
	});

	it('refuses every destructive operation before touching a repository containing the live folder', async () => {
		const root = temporaryRoot(temporaryRoots);
		const repository = path.join(root, 'repository');
		const live = path.join(repository, 'project');
		fs.mkdirSync(live, { recursive: true });
		initRepository(repository);
		fs.writeFileSync(path.join(repository, 'preserve.md'), 'preserve\n');
		const before = snapshot(repository);
		const unsafe = { ...baseContext(live), projectId: '..' };
		const operations = [
			() => switchContextBranch(unsafe, 'main'),
			() => createContextBranch(unsafe, 'nao/test'),
			() => createContextBranchAndCommit(unsafe, { paths: ['/context.md'], message: 'test' }),
			() => commitContextChanges(unsafe, { paths: ['/context.md'], message: 'test' }),
			() => discardContextFileChange(unsafe, '/context.md'),
			() => discardAllContextChanges(unsafe),
			() => pushContextExplorerBranch(unsafe),
		];

		for (const operation of operations) {
			await expect(operation()).rejects.toThrow('Invalid project id');
		}
		await expect(ensureContextWorktree({ ...baseContext(live), userId: '' })).rejects.toThrow('Invalid user id');
		expect(snapshot(repository)).toEqual(before);
	});

	it.each([
		['no-repo', null, 'token'],
		['no-token', { provider: 'github' as const, repoFullName: 'nao/context' }, null],
	])('returns %s while preserving live browsing', async (reason, configOverride, token) => {
		const root = temporaryRoot(temporaryRoots);
		const live = path.join(root, 'live');
		fs.mkdirSync(live);
		fs.writeFileSync(path.join(live, 'context.md'), 'live\n');
		const context = { ...baseContext(live, configOverride), token };
		const access = await fileAccess(context);

		expect(access.git).toMatchObject({ status: 'unavailable', reason });
		expect((await readFileContent('/context.md', access)).content).toBe('live\n');
	});

	it.each([
		['plain repository', 'repository'],
		['live folder', 'live'],
		['worktrees parent', 'worktrees'],
	])('rejects unsafe guard target: %s', (_label, targetKind) => {
		const root = temporaryRoot(temporaryRoots);
		const live = path.join(root, 'repository', 'project');
		fs.mkdirSync(live, { recursive: true });
		const target =
			targetKind === 'live'
				? live
				: targetKind === 'worktrees'
					? path.join(root, '.nao', 'worktrees')
					: path.join(root, 'repository');
		expect(() => assertSafeDestructiveWorktreeTarget(target, live)).toThrow();
	});
});

interface Fixture {
	root: string;
	bare: string;
	seed: string;
	live: string;
	context: ContextExplorerGitContext;
}

function createFixture(
	temporaryRoots: string[],
	files: Record<string, string> = {
		'nao_config.yaml': 'name: test\n',
		'context.md': 'repository content\n',
	},
): Fixture {
	const root = temporaryRoot(temporaryRoots);
	const bare = path.join(root, 'remote.git');
	const seed = path.join(root, 'seed');
	const live = path.join(root, 'live');
	fs.mkdirSync(seed);
	fs.mkdirSync(live);
	initRepository(seed);
	writeFiles(seed, files);
	commitAll(seed, 'initial');
	runGit(root, ['init', '--bare', '--quiet', '--initial-branch=main', bare]);
	runGit(seed, ['push', bare, 'main']);
	runGit(root, ['--git-dir', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
	fs.writeFileSync(path.join(live, 'context.md'), 'live content\n');
	fs.writeFileSync(path.join(live, 'nao_config.yaml'), 'name: live\n');
	return {
		root,
		bare,
		seed,
		live,
		context: {
			...baseContext(live),
			providerOverride: localProvider(bare),
		},
	};
}

function createLocalCloneFixture(temporaryRoots: string[]): Fixture {
	const fixture = createFixture(temporaryRoots, {
		'project/nao_config.yaml': 'name: test\n',
		'project/context.md': 'repository content\n',
	});
	const clone = path.join(fixture.root, 'clone');
	runGit(fixture.root, ['clone', fixture.bare, clone]);
	runGit(clone, ['remote', 'set-url', 'origin', 'https://github.com/nao/context.git']);
	fixture.live = path.join(clone, 'project');
	fixture.context = {
		...baseContext(fixture.live),
		providerOverride: localProvider(fixture.bare),
	};
	return fixture;
}

async function fileAccess(context: ContextExplorerGitContext) {
	return {
		projectFolder: context.projectFolder,
		git: await resolveContextExplorerGit(context),
	};
}

function baseContext(
	projectFolder: string,
	configOverride: ContextExplorerGitContext['configOverride'] = {
		provider: 'github',
		repoFullName: 'nao/context',
	},
): ContextExplorerGitContext {
	return {
		projectId: 'project-id',
		projectFolder,
		userId: 'user-1',
		user: { name: 'Test User', email: 'test@example.com' },
		token: 'test-token',
		configOverride,
		integrationAvailableOverride: true,
	};
}

function setContextSourceEnv({
	source = 'git',
	url = 'https://github.com/nao/context.git',
	branch,
	subpath,
	token,
	sshKey,
	platform,
}: {
	source?: string | null;
	url?: string;
	branch?: string;
	subpath?: string;
	token?: string;
	sshKey?: string;
	platform?: 'github' | 'gitlab' | 'bitbucket';
}): void {
	delete process.env.NAO_CONTEXT_SOURCE;
	delete process.env.NAO_CONTEXT_GIT_URL;
	delete process.env.NAO_CONTEXT_GIT_BRANCH;
	delete process.env.NAO_CONTEXT_GIT_SUBPATH;
	delete process.env.NAO_CONTEXT_GIT_TOKEN;
	delete process.env.NAO_CONTEXT_GIT_SSH_KEY;
	delete process.env.NAO_CONTEXT_GIT_PLATFORM;
	if (source) {
		process.env.NAO_CONTEXT_SOURCE = source;
	}
	if (url !== undefined) {
		process.env.NAO_CONTEXT_GIT_URL = url;
	}
	if (branch !== undefined) {
		process.env.NAO_CONTEXT_GIT_BRANCH = branch;
	}
	if (subpath !== undefined) {
		process.env.NAO_CONTEXT_GIT_SUBPATH = subpath;
	}
	if (token !== undefined) {
		process.env.NAO_CONTEXT_GIT_TOKEN = token;
	}
	if (sshKey !== undefined) {
		process.env.NAO_CONTEXT_GIT_SSH_KEY = sshKey;
	}
	if (platform !== undefined) {
		process.env.NAO_CONTEXT_GIT_PLATFORM = platform;
	}
	__reloadEnvForTesting();
}

function localProvider(bare: string, publicUrl = 'https://github.com/nao/context.git'): ContextRepositoryProvider {
	let openReviewRequest: { kind: 'created'; url: string } | null = null;
	return {
		getToken: async () => 'test-token',
		notConnectedMessage: 'Not connected.',
		isIntegrationAvailable: () => true,
		authenticatedRepoUrl: () => bare,
		publicRepoUrl: () => publicUrl,
		cloneRepo: () => undefined,
		getGitInfo: () => ({ branch: 'main' }),
		getUserGitIdentity: async ({ user }) => user,
		coAuthor: { name: 'nao', email: 'naoagent@getnao.io' },
		commitAllAndPushBranch: () => undefined,
		pushBranch: ({ dir, branch }) => {
			runGit(dir, ['push', bare, `HEAD:refs/heads/${branch}`]);
			return '';
		},
		findOpenReviewRequest: async () => openReviewRequest,
		findReviewRequestByBranch: async () => null,
		openReviewRequest: async () => {
			openReviewRequest = { kind: 'created', url: 'https://github.com/nao/context/pull/1' };
			return openReviewRequest;
		},
	};
}

function writeRemoteChange(fixture: Fixture, filePath: string, content: string): void {
	fs.writeFileSync(path.join(fixture.seed, filePath), content);
	commitAll(fixture.seed, 'remote change');
	runGit(fixture.seed, ['push', fixture.bare, 'main']);
}

function initRepository(folder: string): void {
	runGit(folder, ['init', '--quiet', '--initial-branch=main']);
}

function commitAll(folder: string, message: string): void {
	runGit(folder, ['add', '-A']);
	runGit(folder, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', message]);
}

function writeFiles(root: string, files: Record<string, string>): void {
	for (const [filePath, content] of Object.entries(files)) {
		const target = path.join(root, filePath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content);
	}
}

function temporaryRoot(temporaryRoots: string[]): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-worktree-'));
	temporaryRoots.push(root);
	return root;
}

function runGit(cwd: string, args: string[]): Buffer {
	return execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 10_000 });
}

function snapshot(root: string): Record<string, Buffer> {
	const result: Record<string, Buffer> = {};
	for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) {
			continue;
		}
		const parent = entry.parentPath ?? entry.path;
		const absolute = path.join(parent, entry.name);
		result[path.relative(root, absolute)] = fs.readFileSync(absolute);
	}
	return result;
}

function expectLiveUnchanged(live: string, before: Record<string, Buffer>): void {
	expect(snapshot(live)).toEqual(before);
	expect(fs.existsSync(path.join(live, '.git'))).toBe(false);
}
