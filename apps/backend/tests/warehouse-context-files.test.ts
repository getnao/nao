import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	claimWarehouseProvisioningJobContextFiles: vi.fn(),
	getWarehouseProvisioningJob: vi.fn(),
	releaseWarehouseProvisioningJobLock: vi.fn(),
}));

vi.mock('../src/queries/warehouse-provisioning-job.queries', () => ({
	claimWarehouseProvisioningJobContextFiles: mocks.claimWarehouseProvisioningJobContextFiles,
	getWarehouseProvisioningJob: mocks.getWarehouseProvisioningJob,
	releaseWarehouseProvisioningJobLock: mocks.releaseWarehouseProvisioningJobLock,
}));

import {
	cleanupWarehouseContextFiles,
	clearWarehouseContextFiles,
	MAX_WAREHOUSE_CONTEXT_FILE_SIZE_BYTES,
	restoreWarehouseContextFiles,
	saveWarehouseContextFile,
} from '../src/services/warehouse-context-files';

describe('warehouse context files', () => {
	const temporaryDirectories: string[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.claimWarehouseProvisioningJobContextFiles.mockImplementation(async (jobId: string, userId: string) => {
			const job = await mocks.getWarehouseProvisioningJob(jobId, userId);
			return job?.status === 'awaiting_sources' ? job : null;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		for (const directory of temporaryDirectories.splice(0)) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it('stages UTF-8 Markdown outside the disposable job project', async () => {
		const temporaryDirectory = createTemporaryDirectory();
		mocks.getWarehouseProvisioningJob.mockResolvedValue({
			status: 'awaiting_sources',
			temporaryDirectory,
		});

		const result = await saveWarehouseContextFile(
			'job-id',
			'user-id',
			'../Quarterly   notes.md',
			Buffer.from('# Notes'),
		);

		expect(mocks.getWarehouseProvisioningJob).toHaveBeenCalledWith('job-id', 'user-id');
		expect(mocks.claimWarehouseProvisioningJobContextFiles).toHaveBeenCalledWith(
			'job-id',
			'user-id',
			expect.stringMatching(/^context-files:/),
			expect.any(Date),
		);
		expect(result).toEqual({
			filename: 'Quarterly notes.md',
			path: 'docs/uploads/Quarterly notes.md',
			size: 7,
		});
		expect(
			fs.readFileSync(
				path.join(path.dirname(temporaryDirectory), '.warehouse-onboarding-uploads', 'job-id', result.filename),
				'utf8',
			),
		).toBe('# Notes');
		expect(fs.existsSync(path.join(temporaryDirectory, result.path))).toBe(false);
		expect(mocks.releaseWarehouseProvisioningJobLock).toHaveBeenCalledOnce();
	});

	it('clears a partial staged selection before retrying', async () => {
		const temporaryDirectory = createTemporaryDirectory();
		mocks.getWarehouseProvisioningJob.mockResolvedValue({
			status: 'awaiting_sources',
			temporaryDirectory,
		});
		await saveWarehouseContextFile('job-id', 'user-id', 'old.md', Buffer.from('# Old'));

		await clearWarehouseContextFiles('job-id', 'user-id');

		expect(
			fs.existsSync(path.join(path.dirname(temporaryDirectory), '.warehouse-onboarding-uploads', 'job-id')),
		).toBe(false);
	});

	it('keeps both files when sanitized names collide', async () => {
		const temporaryDirectory = createTemporaryDirectory();
		mocks.getWarehouseProvisioningJob.mockResolvedValue({
			status: 'awaiting_sources',
			temporaryDirectory,
		});

		await saveWarehouseContextFile('job-id', 'user-id', '../notes.txt', Buffer.from('first'));
		const result = await saveWarehouseContextFile('job-id', 'user-id', 'notes.txt', Buffer.from('second'));
		const retried = await saveWarehouseContextFile('job-id', 'user-id', 'notes.txt', Buffer.from('second'));

		expect(result.filename).toBe('notes-2.txt');
		expect(retried.filename).toBe('notes-2.txt');
		expect(
			fs.readFileSync(
				path.join(path.dirname(temporaryDirectory), '.warehouse-onboarding-uploads', 'job-id', result.filename),
				'utf8',
			),
		).toBe('second');
		expect(
			fs
				.readdirSync(path.join(path.dirname(temporaryDirectory), '.warehouse-onboarding-uploads', 'job-id'))
				.sort(),
		).toEqual(['notes-2.txt', 'notes.txt']);
	});

	it('restores staged files into a fresh project and cleans only the staging copy', async () => {
		const temporaryDirectory = createTemporaryDirectory();
		mocks.getWarehouseProvisioningJob.mockResolvedValue({
			status: 'awaiting_sources',
			temporaryDirectory,
		});
		await saveWarehouseContextFile('job-id', 'user-id', 'handbook.md', Buffer.from('# Handbook'));
		const freshProjectDirectory = path.join(path.dirname(temporaryDirectory), 'fresh-project');
		fs.mkdirSync(freshProjectDirectory);

		await restoreWarehouseContextFiles('job-id', freshProjectDirectory);
		await cleanupWarehouseContextFiles('job-id', freshProjectDirectory);

		expect(fs.readFileSync(path.join(freshProjectDirectory, 'docs/uploads/handbook.md'), 'utf8')).toBe(
			'# Handbook',
		);
		expect(
			fs.existsSync(
				path.join(path.dirname(temporaryDirectory), '.warehouse-onboarding-uploads', 'job-id', 'handbook.md'),
			),
		).toBe(false);
	});

	it('rethrows staging directory access errors other than a missing directory', async () => {
		const projectDirectory = createTemporaryDirectory();
		const accessError = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
		vi.spyOn(fsPromises, 'access').mockRejectedValueOnce(accessError);

		await expect(restoreWarehouseContextFiles('job-id', projectDirectory)).rejects.toBe(accessError);
	});

	it('does not expose jobs belonging to another user', async () => {
		mocks.getWarehouseProvisioningJob.mockResolvedValue(null);

		await expect(
			saveWarehouseContextFile('job-id', 'other-user-id', 'notes.md', Buffer.from('notes')),
		).rejects.toMatchObject({
			code: 404,
			message: 'Warehouse setup job not found',
		});
	});

	it('rejects uploads while submission holds the job lease', async () => {
		mocks.claimWarehouseProvisioningJobContextFiles.mockResolvedValueOnce(null);
		mocks.getWarehouseProvisioningJob.mockResolvedValue({
			status: 'awaiting_sources',
			temporaryDirectory: createTemporaryDirectory(),
		});

		await expect(
			saveWarehouseContextFile('job-id', 'user-id', 'notes.md', Buffer.from('notes')),
		).rejects.toMatchObject({ code: 409 });
		expect(mocks.releaseWarehouseProvisioningJobLock).not.toHaveBeenCalled();
	});

	it('rejects uploads after synchronization starts', async () => {
		mocks.getWarehouseProvisioningJob.mockResolvedValue({
			status: 'syncing',
			temporaryDirectory: createTemporaryDirectory(),
		});

		await expect(
			saveWarehouseContextFile('job-id', 'user-id', 'notes.md', Buffer.from('notes')),
		).rejects.toMatchObject({
			code: 409,
		});
	});

	it.each(['notes.pdf', 'notes.exe'])('rejects unsupported file type %s', async (filename) => {
		mocks.getWarehouseProvisioningJob.mockResolvedValue({
			status: 'awaiting_sources',
			temporaryDirectory: createTemporaryDirectory(),
		});

		await expect(
			saveWarehouseContextFile('job-id', 'user-id', filename, Buffer.from('notes')),
		).rejects.toMatchObject({
			code: 400,
			message: `${filename} must be a Markdown or text file`,
		});
	});

	it('rejects oversized and non-UTF-8 files', async () => {
		mocks.getWarehouseProvisioningJob.mockResolvedValue({
			status: 'awaiting_sources',
			temporaryDirectory: createTemporaryDirectory(),
		});

		await expect(
			saveWarehouseContextFile(
				'job-id',
				'user-id',
				'large.txt',
				Buffer.alloc(MAX_WAREHOUSE_CONTEXT_FILE_SIZE_BYTES + 1),
			),
		).rejects.toMatchObject({ code: 400, message: 'large.txt is larger than the 5 MB upload limit' });
		await expect(
			saveWarehouseContextFile('job-id', 'user-id', 'binary.txt', Buffer.from([0xc3, 0x28])),
		).rejects.toMatchObject({ code: 400, message: 'binary.txt is not a valid UTF-8 text file' });
	});

	it('limits the number of staged files per job', async () => {
		const temporaryDirectory = createTemporaryDirectory();
		mocks.getWarehouseProvisioningJob.mockResolvedValue({
			status: 'awaiting_sources',
			temporaryDirectory,
		});
		for (let index = 1; index <= 10; index += 1) {
			await saveWarehouseContextFile('job-id', 'user-id', `note-${index}.txt`, Buffer.from(`${index}`));
		}

		await expect(
			saveWarehouseContextFile('job-id', 'user-id', 'note-11.txt', Buffer.from('11')),
		).rejects.toMatchObject({
			code: 400,
			message: 'You can upload up to 10 business context files',
		});
		expect(
			fs.readdirSync(path.join(path.dirname(temporaryDirectory), '.warehouse-onboarding-uploads', 'job-id')),
		).toHaveLength(10);
	});

	it('limits the combined size of staged files per job', async () => {
		const temporaryDirectory = createTemporaryDirectory();
		mocks.getWarehouseProvisioningJob.mockResolvedValue({
			status: 'awaiting_sources',
			temporaryDirectory,
		});
		const fiveMegabytes = Buffer.alloc(5 * 1024 * 1024, 'a');
		for (let index = 1; index <= 5; index += 1) {
			await saveWarehouseContextFile('job-id', 'user-id', `context-${index}.txt`, fiveMegabytes);
		}

		await expect(
			saveWarehouseContextFile('job-id', 'user-id', 'too-much.txt', Buffer.from('a')),
		).rejects.toMatchObject({
			code: 400,
			message: 'Business context files cannot exceed 25 MB in total',
		});
		expect(
			fs.readdirSync(path.join(path.dirname(temporaryDirectory), '.warehouse-onboarding-uploads', 'job-id')),
		).toHaveLength(5);
	});

	function createTemporaryDirectory(): string {
		const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-upload-test-'));
		const directory = path.join(rootDirectory, 'warehouse-onboarding-job');
		fs.mkdirSync(directory);
		temporaryDirectories.push(rootDirectory);
		return directory;
	}
});
