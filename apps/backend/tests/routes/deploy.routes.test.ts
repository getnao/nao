import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	post: vi.fn(),
	validateApiKey: vi.fn(),
}));

vi.mock('../../src/handlers/context-recommendations.handler', () => ({
	ensureContextRecommendationsScheduleForNewProject: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({}));

vi.mock('../../src/services/api-key.service', () => ({
	validateApiKey: mocks.validateApiKey,
}));

vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: mocks.assertOrganizationCloudBillingAccess,
}));

import { deployRoutes } from '../../src/routes/deploy';

const tempDirs: string[] = [];

beforeEach(async () => {
	vi.clearAllMocks();
	mocks.validateApiKey.mockResolvedValue({ id: 'organization-id' });
	await deployRoutes({ post: mocks.post } as never);
});

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

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

function createProjectSourceDir(): string {
	const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-deploy-test-'));
	tempDirs.push(sourceDir);
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
			status: (code: number) => { send: (body: unknown) => unknown };
		},
	) => Promise<unknown>;
}
