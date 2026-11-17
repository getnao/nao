import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	createProject: vi.fn(),
	getProjectByOrgAndName: vi.fn(),
	post: vi.fn(),
	recordProjectDeployment: vi.fn(),
	validateApiKey: vi.fn(),
}));

vi.mock('../../src/handlers/context-recommendations.handler', () => ({
	ensureContextRecommendationsScheduleForNewProject: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({
	getProjectByOrgAndName: mocks.getProjectByOrgAndName,
}));

vi.mock('../../src/services/api-key.service', () => ({
	validateApiKey: mocks.validateApiKey,
}));

vi.mock('../../src/services/project.service', () => ({
	createProject: mocks.createProject,
	recordProjectDeployment: mocks.recordProjectDeployment,
}));

vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: mocks.assertOrganizationCloudBillingAccess,
}));

import { env } from '../../src/env';
import { deployRoutes } from '../../src/routes/deploy';
import { useTemporaryFolders } from '../helpers/temporary-folders';

const createTemporaryFolder = useTemporaryFolders();

beforeEach(async () => {
	vi.clearAllMocks();
	mocks.validateApiKey.mockResolvedValue({ createdBy: 'user-id', organization: { id: 'organization-id' } });
	await deployRoutes({ post: mocks.post } as never);
});

const GIT_HEAD = 'ref: refs/heads/main\n';

describe('deploy route cloud billing access', () => {
	beforeEach(() => {
		mocks.assertOrganizationCloudBillingAccess.mockRejectedValue(new Error('Cloud billing access is restricted'));
	});

	it('allows a restricted organization to reach project upload validation', async () => {
		const file = vi.fn().mockResolvedValue(undefined);

		const { status, send } = await upload(file);

		expect(mocks.validateApiKey).toHaveBeenCalledWith('nao_valid');
		expect(file).toHaveBeenCalledOnce();
		expect(status).toHaveBeenCalledWith(400);
		expect(send).toHaveBeenCalledWith({ error: 'No file uploaded. Send a tar.gz as multipart field "context".' });
		expect(mocks.assertOrganizationCloudBillingAccess).not.toHaveBeenCalled();
	});
});

describe('deploy route archive validation', () => {
	it('rejects an archive containing a symlink to a server file', async () => {
		const sourceDir = createProjectSourceDir();
		fs.symlinkSync('/etc/passwd', path.join(sourceDir, 'passwd.txt'));

		const { status, send } = await uploadArchive(createArchive(sourceDir));

		expect(status).toHaveBeenCalledWith(400);
		expect(send).toHaveBeenCalledWith({
			error: 'Archive entry "passwd.txt" is not a regular file or directory. Symlinks and special files are not allowed.',
		});
	});

	it('rejects an archive containing a nested symlink', async () => {
		const sourceDir = createProjectSourceDir();
		fs.mkdirSync(path.join(sourceDir, 'docs'));
		fs.symlinkSync('/etc', path.join(sourceDir, 'docs', 'etc'));

		const { status, send } = await uploadArchive(createArchive(sourceDir));

		expect(status).toHaveBeenCalledWith(400);
		expect(send).toHaveBeenCalledWith({
			error: 'Archive entry "docs/etc" is not a regular file or directory. Symlinks and special files are not allowed.',
		});
	});

	it.each([
		[
			'a .git folder',
			{ '.git/config': '[core]\n\tfsmonitor = ./run\n', '.git/hooks/post-checkout': '#!/bin/sh\n' },
			'.git',
		],
		['a nested .git folder', { 'repos/dbt/.git/config': '[core]\n' }, 'repos/dbt/.git'],
		['a .git file pointing at another repository', { '.git': 'gitdir: /app/projects/other/.git\n' }, '.git'],
		['a .git folder in another letter case', { '.GIT/config': '[core]\n' }, '.GIT'],
	])('rejects an archive containing %s', async (_label, files, rejectedEntry) => {
		const { status, send } = await deployArchive(files);

		expect(status).toHaveBeenCalledWith(400);
		expect(send).toHaveBeenCalledWith({
			error: `Archive entry "${rejectedEntry}" is Git metadata, which is not allowed. Deploy the project files without it.`,
		});
		expect(mocks.getProjectByOrgAndName).not.toHaveBeenCalled();
		expect(mocks.createProject).not.toHaveBeenCalled();
	});

	it.each([
		[
			'at its root',
			{ HEAD: GIT_HEAD, 'objects/keep': '', 'refs/keep': '', config: '[core]\n\tbare = false\n' },
			'.',
		],
		['in a folder', { 'docs/HEAD': GIT_HEAD, 'docs/objects/keep': '', 'docs/refs/keep': '' }, 'docs'],
		['through a common folder', { 'docs/HEAD': GIT_HEAD, 'docs/commondir': '../shared\n' }, 'docs'],
	])('rejects an archive laid out as a Git repository %s', async (_label, files, rejectedFolder) => {
		const { status, send } = await deployArchive(files);

		expect(status).toHaveBeenCalledWith(400);
		expect(send).toHaveBeenCalledWith({
			error: `Archive folder "${rejectedFolder}" is laid out as a Git repository. Git metadata is not allowed.`,
		});
		expect(mocks.createProject).not.toHaveBeenCalled();
	});

	it('accepts files that only share a name with Git metadata', async () => {
		mocks.getProjectByOrgAndName.mockResolvedValue({
			id: 'existing-project',
			path: createTemporaryFolder('nao-deploy-test-'),
		});

		const { status, send } = await deployArchive({ HEAD: 'notes', 'docs/objects/list.md': '', '.gitignore': '' });

		expect(status).not.toHaveBeenCalled();
		expect(send).toHaveBeenCalledWith({ projectId: 'existing-project', projectName: 'demo', status: 'updated' });
	});

	async function deployArchive(files: Record<string, string>) {
		const sourceDir = createTemporaryFolder('nao-deploy-test-');
		for (const [relativePath, content] of Object.entries({ 'nao_config.yaml': 'project_name: demo\n', ...files })) {
			const filePath = path.join(sourceDir, relativePath);
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, content);
		}
		const send = vi.fn();
		const status = vi.fn(() => ({ send }));

		await handler()(
			{
				headers: { authorization: 'Bearer nao_valid' },
				file: vi.fn().mockResolvedValue({ file: toAsyncIterable(createArchive(sourceDir)) }),
			},
			{ status, send },
		);

		return { status, send };
	}
});

describe('deploy route deployment record', () => {
	let originalProjectsDir: string;

	beforeEach(() => {
		mocks.getProjectByOrgAndName.mockResolvedValue(null);
		mocks.createProject.mockImplementation(async (project: { name: string }) => ({
			id: 'created-project',
			name: project.name,
		}));
		originalProjectsDir = env.NAO_PROJECTS_DIR;
		env.NAO_PROJECTS_DIR = createTemporaryFolder('nao-deploy-projects-');
	});

	afterEach(() => {
		env.NAO_PROJECTS_DIR = originalProjectsDir;
	});

	it('stamps a new project with the deployment time', async () => {
		const send = vi.fn();

		await handler()(deployRequest('analytics'), { status: vi.fn(() => ({ send })), send });

		expect(mocks.createProject).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'analytics',
				orgId: 'organization-id',
				deployedAt: expect.any(Date),
			}),
		);
		expect(mocks.recordProjectDeployment).not.toHaveBeenCalled();
		expect(send).toHaveBeenCalledWith({
			projectId: 'created-project',
			projectName: 'analytics',
			status: 'created',
		});
	});

	it('stamps the existing project when a deployment updates it', async () => {
		const projectDir = createTemporaryFolder('nao-deploy-existing-');
		mocks.getProjectByOrgAndName.mockResolvedValue({ id: 'existing-project', path: projectDir });
		const send = vi.fn();

		await handler()(deployRequest('analytics'), { status: vi.fn(() => ({ send })), send });

		expect(mocks.recordProjectDeployment).toHaveBeenCalledWith('existing-project');
		expect(mocks.createProject).not.toHaveBeenCalled();
		expect(send).toHaveBeenCalledWith({
			projectId: 'existing-project',
			projectName: 'analytics',
			status: 'updated',
		});
	});
});

function uploadArchive(archive: Buffer) {
	return upload(vi.fn().mockResolvedValue({ file: toAsyncIterable(archive) }));
}

async function upload(file: () => Promise<{ file: AsyncIterable<Buffer> } | undefined>) {
	const send = vi.fn();
	const status = vi.fn(() => ({ send }));
	await handler()({ headers: { authorization: 'Bearer nao_valid' }, file }, { status });
	return { status, send };
}

function deployRequest(projectName: string) {
	const sourceDir = createTemporaryFolder('nao-deploy-source-');
	fs.writeFileSync(path.join(sourceDir, 'nao_config.yaml'), `project_name: ${projectName}\n`);
	return {
		headers: { authorization: 'Bearer nao_valid' },
		file: vi.fn().mockResolvedValue({ file: toAsyncIterable(createArchive(sourceDir)) }),
	};
}

function createProjectSourceDir(): string {
	const sourceDir = createTemporaryFolder('nao-deploy-test-');
	fs.writeFileSync(path.join(sourceDir, 'nao_config.yaml'), 'project_name: leak\n');
	return sourceDir;
}

function createArchive(sourceDir: string): Buffer {
	const archivePath = path.join(sourceDir, '..', `${path.basename(sourceDir)}.tar.gz`);
	execFileSync('tar', ['czf', archivePath, '-C', sourceDir, '.']);
	const archive = fs.readFileSync(archivePath);
	fs.rmSync(archivePath, { force: true });
	return archive;
}

async function* toAsyncIterable(buffer: Buffer): AsyncIterable<Buffer> {
	yield buffer;
}

function handler() {
	return mocks.post.mock.calls[0][1] as (
		request: {
			headers: { authorization?: string };
			file: () => Promise<{ file: AsyncIterable<Buffer> } | undefined>;
		},
		reply: {
			send?: (body: unknown) => unknown;
			status: (code: number) => { send: (body: unknown) => unknown };
		},
	) => Promise<unknown>;
}
