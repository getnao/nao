import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import {
	BUSINESS_CONTEXT_FILE_EXTENSIONS,
	documentExtension,
	MAX_BUSINESS_CONTEXT_FILE_SIZE_MB,
	MAX_BUSINESS_CONTEXT_FILES,
	MAX_BUSINESS_CONTEXT_TOTAL_SIZE_MB,
	toSafeFileName,
} from '@nao/shared/attachments';

import * as warehouseProvisioningJobQueries from '../queries/warehouse-provisioning-job.queries';
import { HandlerError } from '../utils/error';

export const MAX_WAREHOUSE_CONTEXT_FILE_SIZE_BYTES = MAX_BUSINESS_CONTEXT_FILE_SIZE_MB * 1024 * 1024;
const MAX_WAREHOUSE_CONTEXT_TOTAL_SIZE_BYTES = MAX_BUSINESS_CONTEXT_TOTAL_SIZE_MB * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set<string>(BUSINESS_CONTEXT_FILE_EXTENSIONS);
const PROJECT_UPLOAD_DIRECTORY = path.join('docs', 'uploads');
const STAGING_DIRECTORY = '.warehouse-onboarding-uploads';
const CONTEXT_FILE_LEASE_MS = 5 * 60_000;

export async function saveWarehouseContextFile(
	jobId: string,
	userId: string,
	originalFileName: string,
	data: Buffer,
): Promise<{ filename: string; path: string; size: number }> {
	return withWritableContextFiles(jobId, userId, async (temporaryDirectory) => {
		const filename = validateFile(originalFileName, data);
		const uploadDirectory = getStagingDirectory(jobId, temporaryDirectory);
		await fs.mkdir(uploadDirectory, { recursive: true });
		const stored = await writeWithoutReplacing(uploadDirectory, filename, data);
		try {
			await validateUploadDirectory(uploadDirectory);
		} catch (error) {
			if (stored.created) {
				await fs.rm(path.join(uploadDirectory, stored.filename), { force: true });
			}
			throw error;
		}

		return {
			filename: stored.filename,
			path: path.posix.join('docs', 'uploads', stored.filename),
			size: data.length,
		};
	});
}

export async function clearWarehouseContextFiles(jobId: string, userId: string): Promise<void> {
	await withWritableContextFiles(jobId, userId, (temporaryDirectory) =>
		cleanupWarehouseContextFiles(jobId, temporaryDirectory),
	);
}

export async function restoreWarehouseContextFiles(jobId: string, projectDirectory: string): Promise<void> {
	const stagingDirectory = getStagingDirectory(jobId, projectDirectory);
	try {
		await fs.access(stagingDirectory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return;
		}
		throw error;
	}

	await fs.mkdir(path.join(projectDirectory, PROJECT_UPLOAD_DIRECTORY), { recursive: true });
	await fs.cp(stagingDirectory, path.join(projectDirectory, PROJECT_UPLOAD_DIRECTORY), { recursive: true });
}

export async function cleanupWarehouseContextFiles(jobId: string, projectDirectory: string): Promise<void> {
	const stagingDirectory = getStagingDirectory(jobId, projectDirectory);
	await fs.rm(stagingDirectory, { recursive: true, force: true });
	await fs.rmdir(path.dirname(stagingDirectory)).catch(() => undefined);
}

async function withWritableContextFiles<T>(
	jobId: string,
	userId: string,
	action: (temporaryDirectory: string) => Promise<T>,
): Promise<T> {
	const workerId = `context-files:${crypto.randomUUID()}`;
	const job = await warehouseProvisioningJobQueries.claimWarehouseProvisioningJobContextFiles(
		jobId,
		userId,
		workerId,
		new Date(Date.now() - CONTEXT_FILE_LEASE_MS),
	);
	if (!job) {
		const existingJob = await warehouseProvisioningJobQueries.getWarehouseProvisioningJob(jobId, userId);
		if (!existingJob) {
			throw new HandlerError('NOT_FOUND', 'Warehouse setup job not found');
		}
		throw new HandlerError('CONFLICT', 'Business context files can only be changed before sync starts.');
	}

	try {
		if (!job.temporaryDirectory) {
			throw new Error('Warehouse setup temporary directory is missing');
		}
		return await action(job.temporaryDirectory);
	} finally {
		await warehouseProvisioningJobQueries.releaseWarehouseProvisioningJobLock(jobId, workerId);
	}
}

function validateFile(originalFileName: string, data: Buffer): string {
	if (data.length > MAX_WAREHOUSE_CONTEXT_FILE_SIZE_BYTES) {
		throw new HandlerError(
			'BAD_REQUEST',
			`${originalFileName} is larger than the ${MAX_BUSINESS_CONTEXT_FILE_SIZE_MB} MB upload limit`,
		);
	}

	const filename = toSafeFileName(originalFileName);
	if (!filename || !ALLOWED_EXTENSIONS.has(documentExtension(filename) ?? '')) {
		throw new HandlerError('BAD_REQUEST', `${originalFileName} must be a Markdown or text file`);
	}

	try {
		new TextDecoder('utf-8', { fatal: true }).decode(data);
	} catch {
		throw new HandlerError('BAD_REQUEST', `${originalFileName} is not a valid UTF-8 text file`);
	}

	return filename;
}

function getStagingDirectory(jobId: string, projectDirectory: string): string {
	return path.join(path.dirname(projectDirectory), STAGING_DIRECTORY, jobId);
}

async function validateUploadDirectory(directory: string): Promise<void> {
	const filenames = (await fs.readdir(directory, { withFileTypes: true }))
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name);
	const sizes: number[] = [];
	for (const filename of filenames) {
		try {
			sizes.push((await fs.stat(path.join(directory, filename))).size);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	}

	if (sizes.length > MAX_BUSINESS_CONTEXT_FILES) {
		throw new HandlerError(
			'BAD_REQUEST',
			`You can upload up to ${MAX_BUSINESS_CONTEXT_FILES} business context files`,
		);
	}
	if (sizes.reduce((total, size) => total + size, 0) > MAX_WAREHOUSE_CONTEXT_TOTAL_SIZE_BYTES) {
		throw new HandlerError(
			'BAD_REQUEST',
			`Business context files cannot exceed ${MAX_BUSINESS_CONTEXT_TOTAL_SIZE_MB} MB in total`,
		);
	}
}

async function writeWithoutReplacing(
	directory: string,
	filename: string,
	data: Buffer,
): Promise<{ filename: string; created: boolean }> {
	const extension = path.extname(filename);
	const stem = path.basename(filename, extension);
	let suffix = 1;

	while (true) {
		const candidate = suffix === 1 ? filename : `${stem}-${suffix}${extension}`;
		const candidatePath = path.join(directory, candidate);
		try {
			await fs.writeFile(candidatePath, data, { flag: 'wx', mode: 0o600 });
			return { filename: candidate, created: true };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
				throw error;
			}
		}

		try {
			if ((await fs.readFile(candidatePath)).equals(data)) {
				return { filename: candidate, created: false };
			}
			suffix += 1;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	}
}
