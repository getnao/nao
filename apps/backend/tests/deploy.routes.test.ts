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

vi.mock('../src/handlers/context-recommendations.handler', () => ({
	ensureContextRecommendationsScheduleForNewProject: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({}));

vi.mock('../src/services/api-key.service', () => ({
	validateApiKey: mocks.validateApiKey,
}));

vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: mocks.assertOrganizationCloudBillingAccess,
}));

import { deployRoutes } from '../src/routes/deploy';

describe('deploy route cloud billing access', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.validateApiKey.mockResolvedValue({
			status: 'ok',
			org: { id: 'organization-id' },
			scope: 'deploy',
		});
		mocks.assertOrganizationCloudBillingAccess.mockRejectedValue(new Error('Cloud billing access is restricted'));
		await deployRoutes({ post: mocks.post } as never);
	});

	it('allows a restricted organization to reach project upload validation', async () => {
		const send = vi.fn();
		const status = vi.fn(() => ({ send }));
		const file = vi.fn().mockResolvedValue(undefined);

		await handler()(
			{
				headers: { authorization: 'Bearer nao_valid' },
				file,
			},
			{ status },
		);

		expect(mocks.validateApiKey).toHaveBeenCalledWith('nao_valid');
		expect(file).toHaveBeenCalledOnce();
		expect(status).toHaveBeenCalledWith(400);
		expect(send).toHaveBeenCalledWith({ error: 'No file uploaded. Send a tar.gz as multipart field "context".' });
		expect(mocks.assertOrganizationCloudBillingAccess).not.toHaveBeenCalled();
	});

	it('answers 403 for a key scoped to another API, and 401 for a key that is not one', async () => {
		mocks.validateApiKey.mockResolvedValue({ status: 'scope_mismatch' });
		const unscoped = reply();
		await handler()({ headers: { authorization: 'Bearer nao_user_management' }, file: vi.fn() }, unscoped);
		expect(unscoped.status).toHaveBeenCalledWith(403);
		expect(unscoped.send).toHaveBeenCalledWith({ error: 'This API key is not scoped for deploy' });

		mocks.validateApiKey.mockResolvedValue({ status: 'invalid' });
		const invalid = reply();
		await handler()({ headers: { authorization: 'Bearer nao_nope' }, file: vi.fn() }, invalid);
		expect(invalid.status).toHaveBeenCalledWith(401);
		expect(invalid.send).toHaveBeenCalledWith({ error: 'Invalid API key' });
	});
});

describe('deploy route archive validation', () => {
	const tempDirs: string[] = [];

	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.validateApiKey.mockResolvedValue({ status: 'ok', org: { id: 'organization-id' }, scope: 'deploy' });
		await deployRoutes({ post: mocks.post } as never);
	});

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it('rejects an archive containing a symlink to a server file', async () => {
		const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-deploy-test-'));
		tempDirs.push(sourceDir);
		fs.writeFileSync(path.join(sourceDir, 'nao_config.yaml'), 'project_name: leak\n');
		fs.symlinkSync('/etc/passwd', path.join(sourceDir, 'passwd.txt'));
		const archive = createArchive(sourceDir);

		const send = vi.fn();
		const status = vi.fn(() => ({ send }));

		await handler()(
			{
				headers: { authorization: 'Bearer nao_valid' },
				file: vi.fn().mockResolvedValue({ file: toAsyncIterable(archive) }),
			},
			{ status },
		);

		expect(status).toHaveBeenCalledWith(400);
		expect(send).toHaveBeenCalledWith({
			error: 'Archive entry "passwd.txt" is not a regular file or directory. Symlinks and special files are not allowed.',
		});
	});

	it('rejects an archive containing a nested symlink', async () => {
		const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-deploy-test-'));
		tempDirs.push(sourceDir);
		fs.writeFileSync(path.join(sourceDir, 'nao_config.yaml'), 'project_name: leak\n');
		fs.mkdirSync(path.join(sourceDir, 'docs'));
		fs.symlinkSync('/etc', path.join(sourceDir, 'docs', 'etc'));
		const archive = createArchive(sourceDir);

		const send = vi.fn();
		const status = vi.fn(() => ({ send }));

		await handler()(
			{
				headers: { authorization: 'Bearer nao_valid' },
				file: vi.fn().mockResolvedValue({ file: toAsyncIterable(archive) }),
			},
			{ status },
		);

		expect(status).toHaveBeenCalledWith(400);
		expect(send).toHaveBeenCalledWith({
			error: 'Archive entry "docs/etc" is not a regular file or directory. Symlinks and special files are not allowed.',
		});
	});
});

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

function reply() {
	const send = vi.fn();
	return { send, status: vi.fn(() => ({ send })) };
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
