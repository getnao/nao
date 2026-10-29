import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockWarehouseJob = {
	id: string;
	userId: string;
	orgId: string;
	projectName: string;
	provider: string;
	status: string;
	failedStatus?: string | null;
	onboardingChatId: string | null;
	projectId: string | null;
	encryptedCredentials: string | null;
	businessContext: Record<string, string> | null;
	modelSelection: Record<string, string> | null;
	modelProjectId: string | null;
	logs: string | null;
	error: string | null;
	temporaryDirectory: string | null;
	lockedBy: string | null;
	lockedAt: Date | null;
	attempts: number;
	createdAt: Date;
	updatedAt: Date;
	finishedAt: Date | null;
};

const warehouseJobs = vi.hoisted(() => new Map<string, MockWarehouseJob>());
const controls = vi.hoisted(() => ({ failReadyUpdate: false }));

vi.mock('../src/handlers/context-recommendations.handler', () => ({
	contextRecommendationsJobUniqueKey: (projectId: string) => `context.recommendations:${projectId}`,
}));
vi.mock('../src/queries/project.queries', () => ({
	deleteProject: vi.fn(),
	getProjectById: vi.fn(),
	getProjectByOrgAndName: vi.fn(),
	listUserProjects: vi.fn(async () => []),
}));
vi.mock('../src/queries/scheduled-job.queries', () => ({
	deleteJobByUniqueKey: vi.fn(),
}));
vi.mock('../src/queries/warehouse-connection-check.queries', () => ({
	createWarehouseConnectionCheck: vi.fn(),
	getLatestWarehouseConnectionCheck: vi.fn(async () => null),
}));
vi.mock('../src/queries/warehouse-provisioning-job.queries', () => ({
	createWarehouseProvisioningJob: vi.fn(async (input: Partial<MockWarehouseJob> & { id: string }) => {
		const activeJob = [...warehouseJobs.values()].find(
			(job) => job.userId === input.userId && !['ready', 'failed', 'cancelled'].includes(job.status),
		);
		if (activeJob) {
			throw new Error('Unique active warehouse job');
		}

		const now = new Date();
		const job: MockWarehouseJob = {
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres',
			status: 'queued',
			failedStatus: null,
			onboardingChatId: null,
			projectId: null,
			encryptedCredentials: null,
			businessContext: null,
			modelSelection: null,
			modelProjectId: null,
			logs: null,
			error: null,
			temporaryDirectory: null,
			lockedBy: null,
			lockedAt: null,
			attempts: 0,
			createdAt: now,
			updatedAt: now,
			finishedAt: null,
			...input,
		};
		warehouseJobs.set(job.id, job);
		return job;
	}),
	getWarehouseProvisioningJob: vi.fn(async (jobId: string, userId: string) => {
		const job = warehouseJobs.get(jobId);
		return job?.userId === userId ? job : null;
	}),
	getWarehouseProvisioningJobById: vi.fn(async (jobId: string) => warehouseJobs.get(jobId) ?? null),
	listStoppedSetupProjectIds: vi.fn(async (userId: string) =>
		[...warehouseJobs.values()]
			.filter((job) => job.userId === userId && ['failed', 'cancelled'].includes(job.status) && job.projectId)
			.map((job) => job.projectId as string),
	),
	getActiveWarehouseProvisioningJobByUser: vi.fn(async (userId: string) => {
		return (
			[...warehouseJobs.values()]
				.reverse()
				.find((job) => job.userId === userId && !['ready', 'failed', 'cancelled'].includes(job.status)) ?? null
		);
	}),
	getActiveWarehouseProvisioningJob: vi.fn(async (userId: string, chatId: string) => {
		return (
			[...warehouseJobs.values()]
				.reverse()
				.find(
					(job) =>
						job.userId === userId &&
						job.onboardingChatId === chatId &&
						!['ready', 'failed', 'cancelled'].includes(job.status),
				) ?? null
		);
	}),
	getLatestWarehouseProvisioningJob: vi.fn(async (userId: string, chatId: string) => {
		return (
			[...warehouseJobs.values()]
				.reverse()
				.find((job) => job.userId === userId && job.onboardingChatId === chatId) ?? null
		);
	}),
	updateWarehouseProvisioningJob: vi.fn(async (jobId: string, changes: Partial<MockWarehouseJob>) => {
		if (controls.failReadyUpdate && changes.status === 'ready') {
			throw new Error('Database unavailable');
		}
		const job = warehouseJobs.get(jobId);
		if (!job || job.status === 'cancelled') {
			return null;
		}
		const updated = { ...job, ...changes, updatedAt: new Date() };
		warehouseJobs.set(jobId, updated);
		return updated;
	}),
	cancelWarehouseProvisioningJob: vi.fn(async (jobId: string, error: string) => {
		const job = warehouseJobs.get(jobId);
		if (!job || ['ready', 'failed', 'cancelled'].includes(job.status)) {
			return null;
		}
		const cancelled = {
			...job,
			status: 'cancelled',
			failedStatus: job.status,
			error,
			encryptedCredentials: null,
			finishedAt: new Date(),
		};
		warehouseJobs.set(jobId, cancelled);
		return cancelled;
	}),
	claimWarehouseProvisioningJob: vi.fn(
		async (jobId: string, workerId: string, statuses: string[], staleBefore: Date) => {
			const job = warehouseJobs.get(jobId);
			if (!job || !statuses.includes(job.status) || (job.lockedAt !== null && job.lockedAt >= staleBefore)) {
				return null;
			}
			const claimed = {
				...job,
				lockedBy: workerId,
				lockedAt: new Date(),
				attempts: job.attempts + 1,
			};
			warehouseJobs.set(jobId, claimed);
			return claimed;
		},
	),
	renewWarehouseProvisioningJobLock: vi.fn(async (jobId: string, workerId: string) => {
		const job = warehouseJobs.get(jobId);
		if (!job || job.lockedBy !== workerId) {
			return false;
		}
		warehouseJobs.set(jobId, { ...job, lockedAt: new Date() });
		return true;
	}),
	releaseWarehouseProvisioningJobLock: vi.fn(async (jobId: string, workerId: string) => {
		const job = warehouseJobs.get(jobId);
		if (job?.lockedBy === workerId) {
			warehouseJobs.set(jobId, { ...job, lockedBy: null, lockedAt: null });
		}
	}),
	clearFinishedWarehouseProvisioningCredentials: vi.fn(async (finishedBefore: Date) => {
		for (const job of warehouseJobs.values()) {
			if (['failed', 'cancelled'].includes(job.status) && job.finishedAt && job.finishedAt < finishedBefore) {
				warehouseJobs.set(job.id, { ...job, encryptedCredentials: null });
			}
		}
	}),
	listRecoverableWarehouseProvisioningJobs: vi.fn(async (statuses: string[], staleBefore: Date) =>
		[...warehouseJobs.values()].filter(
			(job) => statuses.includes(job.status) && (job.lockedAt === null || job.lockedAt < staleBefore),
		),
	),
	listAbandonedCancelledWarehouseProvisioningJobs: vi.fn(async (staleBefore: Date) =>
		[...warehouseJobs.values()].filter(
			(job) => job.status === 'cancelled' && job.lockedAt !== null && job.lockedAt < staleBefore,
		),
	),
	clearWarehouseProvisioningJobLock: vi.fn(async (jobId: string) => {
		const job = warehouseJobs.get(jobId);
		if (job) {
			warehouseJobs.set(jobId, { ...job, lockedBy: null, lockedAt: null });
		}
	}),
}));
vi.mock('../src/services/project-import.service', () => ({
	createNewProject: vi.fn(),
	createTempProjectDir: vi.fn(),
}));
vi.mock('../src/services/project.service', () => ({
	reconcileProjectReadiness: vi.fn(),
}));
vi.mock('../src/services/managed-github-repository', () => ({
	deleteManagedGithubRepository: vi.fn(),
	getManagedGithubRepositoryFullName: vi.fn(() => 'nao-org/nao-analytics-owned-project'),
	provisionManagedGithubRepository: vi.fn(),
}));
vi.mock('../src/services/onboarding-rules', () => ({
	generateOnboardingRules: vi.fn(),
}));
vi.mock('../src/services/warehouse-credentials', () => ({
	saveProjectWarehouseEnvVars: vi.fn(),
}));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn() },
	serializeError: (error: unknown) => ({
		message: error instanceof Error ? error.message : String(error),
	}),
}));
vi.mock('node:child_process', () => ({
	spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

import * as projectQueries from '../src/queries/project.queries';
import * as scheduledJobQueries from '../src/queries/scheduled-job.queries';
import * as warehouseConnectionCheckQueries from '../src/queries/warehouse-connection-check.queries';
import * as warehouseProvisioningJobQueries from '../src/queries/warehouse-provisioning-job.queries';
import {
	deleteManagedGithubRepository,
	getManagedGithubRepositoryFullName,
	provisionManagedGithubRepository,
} from '../src/services/managed-github-repository';
import { generateOnboardingRules } from '../src/services/onboarding-rules';
import { reconcileProjectReadiness } from '../src/services/project.service';
import { createNewProject, createTempProjectDir } from '../src/services/project-import.service';
import { saveProjectWarehouseEnvVars } from '../src/services/warehouse-credentials';
import {
	cancelWarehouseProvisioning,
	getLatestWarehouseProvisioningJob,
	getOnboardingWarehouseState,
	getPublicProvisioningError,
	getWarehouseProvisioningJob,
	reconcileWarehouseProvisioningJobs,
	retryWarehouseProvisioning,
	startWarehouseProvisioning,
	submitWarehouseBusinessContext,
	validateWarehouseCredentials,
	waitForWarehouseSetup,
} from '../src/services/warehouse-provisioning';
import { logger } from '../src/utils/logger';

beforeEach(() => {
	vi.clearAllMocks();
	warehouseJobs.clear();
	controls.failReadyUpdate = false;
	vi.mocked(projectQueries.listUserProjects).mockResolvedValue([]);
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('warehouse provisioning', () => {
	it('validates credentials before starting provisioning', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ valid: true }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			validateWarehouseCredentials('user-1', {
				provider: 'postgres',
				credentials: { host: 'warehouse.example.com', password: 'secret', schemaName: 'public' },
			}),
		).resolves.toEqual({ valid: true });
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining('/warehouse/validate'),
			expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
		);
		expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).credentials).toMatchObject({
			schema_name: 'public',
		});
		expect(warehouseConnectionCheckQueries.createWarehouseConnectionCheck).toHaveBeenCalledWith({
			userId: 'user-1',
			provider: 'postgres',
			outcome: 'ok',
			error: undefined,
		});
	});

	it('returns a safe error when credential validation fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 422 })));

		await expect(
			validateWarehouseCredentials('user-1', {
				provider: 'postgres',
				credentials: { host: 'warehouse.example.com', password: 'wrong' },
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'The warehouse rejected these credentials. Check them and try again.',
		});
		expect(warehouseConnectionCheckQueries.createWarehouseConnectionCheck).toHaveBeenCalledWith({
			userId: 'user-1',
			provider: 'postgres',
			outcome: 'connection_error',
			error: 'The warehouse rejected these credentials. Check them and try again.',
		});
	});

	it('records missing credentials separately from connection errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					Response.json(
						{ detail: { code: 'invalid_warehouse_credentials', fields: ['host'] } },
						{ status: 422 },
					),
				),
		);

		await expect(
			validateWarehouseCredentials('user-1', { provider: 'postgres', credentials: { password: 'secret' } }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Could not connect. Check Host.' });
		expect(warehouseConnectionCheckQueries.createWarehouseConnectionCheck).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: 'missing_credentials' }),
		);
	});

	it('records a failed check when the validation service cannot be reached', async () => {
		const unreachable = new TypeError('fetch failed');
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(unreachable));

		await expect(
			validateWarehouseCredentials('user-1', { provider: 'postgres', credentials: { host: 'warehouse' } }),
		).rejects.toBe(unreachable);
		expect(warehouseConnectionCheckQueries.createWarehouseConnectionCheck).toHaveBeenCalledWith({
			userId: 'user-1',
			provider: 'postgres',
			outcome: 'connection_error',
			error: 'The connection could not be checked because the validation service failed.',
		});
	});

	it('still answers the user when the connection check cannot be recorded', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ valid: true })));
		vi.mocked(warehouseConnectionCheckQueries.createWarehouseConnectionCheck).mockRejectedValueOnce(
			new Error('Database unavailable'),
		);

		await expect(
			validateWarehouseCredentials('user-1', { provider: 'postgres', credentials: { host: 'warehouse' } }),
		).resolves.toEqual({ valid: true });
	});

	it('points users to the credentials that need checking', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				Response.json(
					{
						detail: {
							code: 'warehouse_connection_failed',
							fields: ['user', 'password'],
						},
					},
					{ status: 422 },
				),
			),
		);

		await expect(
			validateWarehouseCredentials('user-1', {
				provider: 'postgres',
				credentials: { host: 'warehouse.example.com', password: 'wrong' },
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Could not connect. Check Username and Password.',
		});
	});

	it('exposes queued job state only to its owner without leaking credentials', async () => {
		vi.useFakeTimers();

		const { jobId, status } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres',
			credentials: {
				host: 'warehouse.example.com',
				port: 5432,
				database: 'analytics',
				user: 'nao',
				password: 'super-secret',
			},
		});

		expect(status).toBe('queued');
		expect(await getWarehouseProvisioningJob(jobId, 'user-1')).toEqual({
			id: jobId,
			provider: 'postgres',
			status: 'queued',
			failedStatus: null,
			projectId: null,
			projectName: 'analytics',
			logs: null,
			error: null,
			businessContextProvided: false,
			canRetry: false,
		});
		expect(await getWarehouseProvisioningJob(jobId, 'another-user')).toBeNull();
		expect(JSON.stringify(await getWarehouseProvisioningJob(jobId, 'user-1'))).not.toContain('super-secret');
	});

	it('restores the latest failed job for an onboarding chat', async () => {
		vi.useFakeTimers();

		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			onboardingChatId: 'chat-1',
			provider: 'postgres',
			credentials: {
				host: 'warehouse.example.com',
				password: 'super-secret',
				schemaName: 'public',
			},
		});
		await warehouseProvisioningJobQueries.updateWarehouseProvisioningJob(jobId, {
			status: 'failed',
			logs: 'Sync failed',
			error: 'nao sync failed. Check the logs for details.',
		});

		await expect(getLatestWarehouseProvisioningJob('user-1', 'chat-1')).resolves.toMatchObject({
			id: jobId,
			status: 'failed',
			logs: 'Sync failed',
		});
		await expect(getLatestWarehouseProvisioningJob('another-user', 'chat-1')).resolves.toBeNull();
	});

	it('rejects concurrent provisioning jobs for the same user', async () => {
		vi.useFakeTimers();
		const input = {
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres' as const,
			credentials: { host: 'warehouse.example.com', password: 'secret' },
		};

		const results = await Promise.allSettled([
			startWarehouseProvisioning(input),
			startWarehouseProvisioning(input),
		]);

		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
	});

	it('starts a new setup right after a failed one', async () => {
		const input = {
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres' as const,
			credentials: { host: 'warehouse.example.com', password: 'secret' },
		};
		const { jobId } = await startWarehouseProvisioning(input);
		const job = warehouseJobs.get(jobId);
		if (!job) {
			throw new Error('Expected provisioning job');
		}
		warehouseJobs.set(jobId, { ...job, status: 'failed', finishedAt: new Date() });

		await expect(startWarehouseProvisioning(input)).resolves.toMatchObject({ status: 'queued' });
	});

	it('rejects provisioning when the user already has a connected project', async () => {
		vi.mocked(projectQueries.listUserProjects).mockResolvedValue([{ id: 'project-1' }] as never);

		await expect(
			startWarehouseProvisioning({
				userId: 'user-1',
				orgId: 'org-1',
				projectName: 'analytics',
				provider: 'postgres',
				credentials: { host: 'warehouse.example.com', password: 'secret' },
			}),
		).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('ignores the project of a cancelled setup that is still being rolled back', async () => {
		const input = {
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres' as const,
			credentials: { host: 'warehouse.example.com', password: 'secret' },
		};
		const { jobId } = await startWarehouseProvisioning(input);
		const job = warehouseJobs.get(jobId);
		if (!job) {
			throw new Error('Expected provisioning job');
		}
		warehouseJobs.set(jobId, { ...job, status: 'cancelled', projectId: 'project-1', finishedAt: new Date() });
		vi.mocked(projectQueries.listUserProjects).mockResolvedValue([{ id: 'project-1' }] as never);

		await expect(startWarehouseProvisioning(input)).resolves.toMatchObject({ status: 'queued' });
	});

	it('rolls back a registered project when credential storage fails', async () => {
		const registeredProjectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'registered-project-test-'));
		vi.mocked(projectQueries.getProjectByOrgAndName).mockResolvedValue(null);
		vi.mocked(createTempProjectDir).mockReturnValue(
			fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-onboarding-test-')),
		);
		vi.mocked(createNewProject).mockResolvedValue({
			projectId: 'project-1',
			projectName: 'analytics',
			status: 'created',
		});
		vi.mocked(projectQueries.getProjectById).mockResolvedValue({
			id: 'project-1',
			projectName: 'analytics',
			path: registeredProjectDirectory,
		} as never);
		vi.mocked(saveProjectWarehouseEnvVars).mockRejectedValue(new Error('Credential storage failed'));
		vi.mocked(projectQueries.deleteProject).mockResolvedValue();
		vi.mocked(scheduledJobQueries.deleteJobByUniqueKey).mockResolvedValue();
		vi.mocked(spawn).mockImplementation((_command, args) => {
			const child = Object.assign(new EventEmitter(), {
				stdout: new EventEmitter(),
				stderr: new EventEmitter(),
				kill: vi.fn(),
			});
			queueMicrotask(() => {
				child.stdout.emit('data', Buffer.from(`Running nao ${args?.[0]}\n`));
				child.emit('close', 0);
			});
			return child as never;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						database_config: { type: 'postgres' },
						env_vars: { POSTGRES_PASSWORD: 'secret' },
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				),
			),
		);

		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres',
			credentials: {
				host: 'warehouse.example.com',
				port: 5432,
				database: 'analytics',
				user: 'nao',
				password: 'secret',
			},
		});

		await vi.waitFor(async () => {
			expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('failed');
		});
		expect(warehouseJobs.get(jobId)?.failedStatus).toBe('registering');
		const [creationInput] = vi.mocked(createNewProject).mock.calls[0];
		expect(creationInput.projectId).toEqual(expect.any(String));
		expect(warehouseProvisioningJobQueries.updateWarehouseProvisioningJob).toHaveBeenCalledWith(jobId, {
			status: 'registering',
		});
		expect(scheduledJobQueries.deleteJobByUniqueKey).toHaveBeenCalledWith('context.recommendations:project-1');
		expect(projectQueries.deleteProject).toHaveBeenCalledWith('project-1');
		expect(fs.existsSync(registeredProjectDirectory)).toBe(false);
	});

	it('finalizes in the background after sync and context are both ready', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-2');

		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			onboardingChatId: 'chat-1',
			provider: 'postgres',
			credentials: {
				host: 'warehouse.example.com',
				port: 5432,
				database: 'analytics',
				user: 'nao',
				password: 'secret',
			},
		});

		await submitWarehouseBusinessContext('user-1', 'chat-1', {
			businessContext: { additionalContext: 'A bicycle rental company.' },
			modelSelection: { provider: 'openai', modelId: 'gpt-4o-mini' },
			modelProjectId: 'example-project',
		});

		expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('queued');
		expect(generateOnboardingRules).not.toHaveBeenCalled();

		await vi.waitFor(async () => {
			expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('ready');
		});
		expect(generateOnboardingRules).toHaveBeenCalledWith(
			'project-2',
			{ additionalContext: 'A bicycle rental company.' },
			{ provider: 'openai', modelId: 'gpt-4o-mini' },
			'example-project',
			'user-1',
		);
		expect(provisionManagedGithubRepository).toHaveBeenCalledWith({
			projectId: 'project-2',
			projectName: 'analytics',
			projectDir: registeredProjectDirectory,
		});
		expect(reconcileProjectReadiness).toHaveBeenCalledWith('project-2');
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('deletes a newly created managed repository when the final database update fails', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-publish-failure');
		controls.failReadyUpdate = true;

		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			onboardingChatId: 'chat-1',
			provider: 'postgres',
			credentials: {
				host: 'warehouse.example.com',
				port: 5432,
				database: 'analytics',
				user: 'nao',
				password: 'secret',
			},
		});

		await submitWarehouseBusinessContext('user-1', 'chat-1', {
			businessContext: { additionalContext: 'A bicycle rental company.' },
			modelSelection: { provider: 'openai', modelId: 'gpt-4o-mini' },
			modelProjectId: 'example-project',
		});

		await vi.waitFor(async () => {
			expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('failed');
		});
		expect(reconcileProjectReadiness).not.toHaveBeenCalledWith('project-publish-failure');
		expect(deleteManagedGithubRepository).toHaveBeenCalledWith('nao-org/nao-analytics-project');
		expect(projectQueries.deleteProject).toHaveBeenCalledWith('project-publish-failure');
		expect(fs.existsSync(registeredProjectDirectory)).toBe(false);
	});

	it('restores environment references after init before registering the project', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-safe-config');
		let registeredConfig = '';
		vi.mocked(createNewProject).mockImplementation(async ({ sourceDir }) => {
			registeredConfig = fs.readFileSync(path.join(sourceDir, 'nao_config.yaml'), 'utf8');
			return {
				projectId: 'project-safe-config',
				projectName: 'analytics',
				status: 'created',
			};
		});
		vi.mocked(spawn).mockImplementation((_command, args, options) => {
			const child = Object.assign(new EventEmitter(), {
				stdout: new EventEmitter(),
				stderr: new EventEmitter(),
				kill: vi.fn(),
			});
			if (args?.[0] === 'init') {
				fs.writeFileSync(
					path.join(String(options?.cwd), 'nao_config.yaml'),
					'project_name: analytics\ndatabases:\n  - type: postgres\n    password: super-secret\n',
				);
			}
			queueMicrotask(() => {
				child.stdout.emit('data', Buffer.from(`Running nao ${args?.[0]}\n`));
				child.emit('close', 0);
			});
			return child as never;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						database_config: {
							type: 'postgres',
							password: "${{ env('NAO_ONBOARDING_POSTGRES_PASSWORD') }}",
						},
						env_vars: { NAO_ONBOARDING_POSTGRES_PASSWORD: '"super-secret"' },
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				),
			),
		);

		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres',
			credentials: { password: 'super-secret' },
		});

		await vi.waitFor(async () => {
			expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('awaiting_context');
		});
		expect(warehouseJobs.get(jobId)?.attempts).toBe(0);
		expect(vi.mocked(spawn).mock.calls.map(([, args]) => args)).toEqual([
			['init', '--yes'],
			['debug'],
			['sync', '--provider', 'databases'],
		]);
		expect(registeredConfig).toContain('project_name: analytics');
		expect(registeredConfig).toContain('name: postgres');
		expect(registeredConfig).toContain('templates:');
		expect(registeredConfig).toContain('- columns');
		expect(registeredConfig).toContain('- preview');
		expect(registeredConfig).toContain("env('NAO_ONBOARDING_POSTGRES_PASSWORD')");
		expect(registeredConfig).not.toContain('super-secret');
		expect(warehouseJobs.get(jobId)?.logs).toContain('Running nao sync');
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('fails and rolls back finalization when the onboarding model is unavailable', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-3');
		vi.mocked(projectQueries.deleteProject).mockResolvedValue();
		vi.mocked(scheduledJobQueries.deleteJobByUniqueKey).mockResolvedValue();

		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			onboardingChatId: 'chat-1',
			provider: 'postgres',
			credentials: {
				host: 'warehouse.example.com',
				port: 5432,
				database: 'analytics',
				user: 'nao',
				password: 'secret',
			},
		});

		await submitWarehouseBusinessContext('user-1', 'chat-1', {
			businessContext: {},
			modelProjectId: 'example-project',
		});

		await vi.waitFor(async () => {
			expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('failed');
		});
		expect(generateOnboardingRules).not.toHaveBeenCalled();
		expect(projectQueries.deleteProject).toHaveBeenCalledWith('project-3');
		expect(fs.existsSync(registeredProjectDirectory)).toBe(false);
	});

	it('recovers an abandoned queued job and only lets one worker claim it', async () => {
		vi.useFakeTimers();
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-recovered');
		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres',
			credentials: {
				host: 'warehouse.example.com',
				port: 5432,
				database: 'analytics',
				user: 'nao',
				password: 'secret',
			},
		});

		await Promise.all([reconcileWarehouseProvisioningJobs(), reconcileWarehouseProvisioningJobs()]);

		expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('awaiting_context');
		expect(spawn).toHaveBeenCalledTimes(3);
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('fails an abandoned job after its retry budget is exhausted', async () => {
		vi.useFakeTimers();
		const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-onboarding-exhausted-'));
		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres',
			credentials: { host: 'warehouse.example.com', password: 'secret' },
		});
		const job = warehouseJobs.get(jobId);
		if (!job) {
			throw new Error('Expected provisioning job');
		}
		warehouseJobs.set(jobId, {
			...job,
			status: 'syncing',
			attempts: 5,
			temporaryDirectory,
		});

		await reconcileWarehouseProvisioningJobs();

		expect(warehouseJobs.get(jobId)).toMatchObject({
			status: 'failed',
			failedStatus: 'syncing',
			attempts: 5,
			encryptedCredentials: expect.any(String),
			temporaryDirectory: null,
			error: 'Warehouse setup stopped unexpectedly several times. Please try again.',
		});
		expect(fs.existsSync(temporaryDirectory)).toBe(false);
		expect(spawn).not.toHaveBeenCalled();
	});

	it('deletes the managed repository when an abandoned publishing job exhausts its retry budget', async () => {
		vi.useFakeTimers();
		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres',
			credentials: { host: 'warehouse.example.com', password: 'secret' },
		});
		const job = warehouseJobs.get(jobId);
		if (!job) {
			throw new Error('Expected provisioning job');
		}
		warehouseJobs.set(jobId, {
			...job,
			status: 'publishing',
			attempts: 5,
			projectId: 'owned-project',
			encryptedCredentials: null,
		});
		vi.mocked(projectQueries.deleteProject).mockResolvedValue();
		vi.mocked(scheduledJobQueries.deleteJobByUniqueKey).mockResolvedValue();

		await reconcileWarehouseProvisioningJobs();

		expect(getManagedGithubRepositoryFullName).toHaveBeenCalledWith({
			projectId: 'owned-project',
			projectName: 'analytics',
		});
		expect(deleteManagedGithubRepository).toHaveBeenCalledWith('nao-org/nao-analytics-owned-project');
		expect(warehouseJobs.get(jobId)?.status).toBe('failed');
	});

	it('only rolls back the project ID owned by a recovering registration job', async () => {
		vi.useFakeTimers();
		const ownedProjectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'registered-project-owned-'));
		const otherProjectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'registered-project-other-'));
		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres',
			credentials: { host: 'warehouse.example.com', password: 'secret' },
		});
		const job = warehouseJobs.get(jobId);
		if (!job) {
			throw new Error('Expected provisioning job');
		}
		warehouseJobs.set(jobId, {
			...job,
			status: 'registering',
			projectId: 'owned-project',
			encryptedCredentials: null,
		});
		vi.mocked(projectQueries.getProjectById).mockResolvedValue({
			id: 'owned-project',
			projectName: 'analytics',
			path: ownedProjectDirectory,
		} as never);
		vi.mocked(projectQueries.getProjectByOrgAndName).mockResolvedValue({
			id: 'other-project',
			projectName: 'analytics',
			path: otherProjectDirectory,
		} as never);
		vi.mocked(projectQueries.deleteProject).mockResolvedValue();
		vi.mocked(scheduledJobQueries.deleteJobByUniqueKey).mockResolvedValue();

		await reconcileWarehouseProvisioningJobs();

		expect(projectQueries.deleteProject).toHaveBeenCalledWith('owned-project');
		expect(projectQueries.deleteProject).not.toHaveBeenCalledWith('other-project');
		expect(projectQueries.getProjectByOrgAndName).not.toHaveBeenCalled();
		expect(fs.existsSync(ownedProjectDirectory)).toBe(false);
		expect(fs.existsSync(otherProjectDirectory)).toBe(true);
		fs.rmSync(otherProjectDirectory, { recursive: true, force: true });
	});

	it('resumes abandoned finalization from its persisted context', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-finalization-recovery');
		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres',
			credentials: {
				host: 'warehouse.example.com',
				port: 5432,
				database: 'analytics',
				user: 'nao',
				password: 'secret',
			},
		});

		await vi.waitFor(async () => {
			expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('awaiting_context');
		});
		const job = warehouseJobs.get(jobId);
		if (!job) {
			throw new Error('Expected provisioning job');
		}
		warehouseJobs.set(jobId, {
			...job,
			status: 'finalizing',
			businessContext: { additionalContext: 'A bicycle rental company.' },
			modelSelection: { provider: 'openai', modelId: 'gpt-4o-mini' },
			modelProjectId: 'example-project',
		});

		await reconcileWarehouseProvisioningJobs();

		expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('ready');
		expect(generateOnboardingRules).toHaveBeenCalledWith(
			'project-finalization-recovery',
			{ additionalContext: 'A bicycle rental company.' },
			{ provider: 'openai', modelId: 'gpt-4o-mini' },
			'example-project',
			'user-1',
		);
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('retries a stopped setup with its stored credentials and business context', async () => {
		vi.useFakeTimers();
		const { jobId } = await startOnboardingSetup();
		const failedJob = markJobFailed(jobId, {
			businessContext: { additionalContext: 'A bicycle rental company.' },
			modelProjectId: 'example-project',
		});

		const retriedJob = await retryWarehouseProvisioning('user-1', 'chat-1');

		expect(retriedJob).toMatchObject({ status: 'queued', provider: 'postgres', businessContextProvided: true });
		expect(warehouseJobs.get(retriedJob.id)).toMatchObject({
			onboardingChatId: 'chat-1',
			encryptedCredentials: failedJob.encryptedCredentials,
			businessContext: { additionalContext: 'A bicycle rental company.' },
			modelProjectId: 'example-project',
		});
		expect(warehouseJobs.get(jobId)?.encryptedCredentials).toBeNull();
	});

	it('asks for the connection details again when a stopped setup no longer stores them', async () => {
		vi.useFakeTimers();
		const { jobId } = await startOnboardingSetup();
		markJobFailed(jobId, { encryptedCredentials: null });

		await expect(retryWarehouseProvisioning('user-1', 'chat-1')).rejects.toMatchObject({
			code: 'PRECONDITION_FAILED',
		});
	});

	it('clears the stored credentials of stopped setups after the retention period', async () => {
		vi.useFakeTimers();
		const { jobId } = await startOnboardingSetup();
		markJobFailed(jobId, { finishedAt: new Date(Date.now() - 2 * 60 * 60_000) });

		await reconcileWarehouseProvisioningJobs();

		expect(warehouseJobs.get(jobId)?.encryptedCredentials).toBeNull();
	});

	it('reports a stopped setup to the agent with its error and logs', async () => {
		vi.useFakeTimers();
		const { jobId } = await startOnboardingSetup();
		markJobFailed(jobId, {
			failedStatus: 'debugging',
			error: 'nao debug failed. Check the logs for details.',
			logs: 'password authentication failed for user "nao"',
		});

		await expect(waitForWarehouseSetup('user-1', 'chat-1')).resolves.toEqual({
			outcome: 'failed',
			setup: {
				provider: 'postgres',
				status: 'failed',
				failedStatus: 'debugging',
				error: 'nao debug failed. Check the logs for details.',
				logs: 'password authentication failed for user "nao"',
				businessContextProvided: false,
				canRetry: true,
			},
		});
	});

	it('reports a verified connection once metadata syncs without business context', async () => {
		vi.useFakeTimers();
		const { jobId } = await startOnboardingSetup();
		await warehouseProvisioningJobQueries.updateWarehouseProvisioningJob(jobId, { status: 'syncing' });

		await expect(waitForWarehouseSetup('user-1', 'chat-1')).resolves.toMatchObject({
			outcome: 'connection_verified',
		});
	});

	it('stops waiting for the setup when the agent run is aborted', async () => {
		vi.useFakeTimers();
		await startOnboardingSetup();
		const controller = new AbortController();
		controller.abort();

		await expect(waitForWarehouseSetup('user-1', 'chat-1', controller.signal)).resolves.toMatchObject({
			outcome: 'running',
			setup: { status: 'queued' },
		});
	});

	it('keeps business context given to a stopped setup for its retry', async () => {
		vi.useFakeTimers();
		const { jobId } = await startOnboardingSetup();
		markJobFailed(jobId);

		await expect(
			submitWarehouseBusinessContext('user-1', 'chat-1', {
				businessContext: { additionalContext: 'A bicycle rental company.' },
				modelProjectId: 'example-project',
			}),
		).rejects.toThrow('The business context was saved and will be used when the setup is retried.');
		expect(warehouseJobs.get(jobId)?.businessContext).toEqual({ additionalContext: 'A bicycle rental company.' });
	});

	it('cancels a setup waiting for business context and rolls back its project', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-cancelled');
		const { jobId } = await startOnboardingSetup();
		await vi.waitFor(() => expect(warehouseJobs.get(jobId)?.status).toBe('awaiting_context'));

		await expect(cancelWarehouseProvisioning('user-1')).resolves.toBe(true);

		expect(warehouseJobs.get(jobId)).toMatchObject({
			status: 'cancelled',
			failedStatus: 'awaiting_context',
			encryptedCredentials: null,
		});
		expect(projectQueries.deleteProject).toHaveBeenCalledWith('project-cancelled');
		await expect(startOnboardingSetup()).resolves.toMatchObject({ status: 'queued' });
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('stops the running command of a cancelled setup without reporting a failure', async () => {
		mockSuccessfulProvisioning('project-running');
		let killSync: ReturnType<typeof vi.fn> | undefined;
		vi.mocked(spawn).mockImplementation((_command, args) => {
			const child = Object.assign(new EventEmitter(), {
				stdout: new EventEmitter(),
				stderr: new EventEmitter(),
				kill: vi.fn(),
			});
			queueMicrotask(async () => {
				if (args?.[0] === 'sync') {
					killSync = child.kill;
					await cancelWarehouseProvisioning('user-1');
					child.stdout.emit('data', Buffer.from('Syncing 10%\n'));
					return;
				}
				child.stdout.emit('data', Buffer.from(`Running nao ${args?.[0]}\n`));
				child.emit('close', 0);
			});
			return child as never;
		});

		const { jobId } = await startOnboardingSetup();

		await vi.waitFor(() => expect(killSync).toHaveBeenCalledWith('SIGTERM'));
		await vi.waitFor(() => expect(warehouseJobs.get(jobId)?.lockedBy).toBeNull());
		expect(warehouseJobs.get(jobId)).toMatchObject({
			status: 'cancelled',
			failedStatus: 'syncing',
			error: 'The warehouse setup was cancelled because the onboarding was restarted.',
		});
		expect(createNewProject).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});

	it('rolls back a cancelled setup whose worker stopped before cleaning up', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-abandoned');
		const { jobId } = await startOnboardingSetup();
		await vi.waitFor(() => expect(warehouseJobs.get(jobId)?.status).toBe('awaiting_context'));
		const job = warehouseJobs.get(jobId);
		if (!job) {
			throw new Error('Expected provisioning job');
		}
		warehouseJobs.set(jobId, { ...job, status: 'finalizing', lockedBy: 'dead-worker', lockedAt: new Date() });

		await expect(cancelWarehouseProvisioning('user-1')).resolves.toBe(true);
		expect(projectQueries.deleteProject).not.toHaveBeenCalled();

		const cancelledJob = warehouseJobs.get(jobId);
		if (!cancelledJob) {
			throw new Error('Expected cancelled job');
		}
		warehouseJobs.set(jobId, { ...cancelledJob, lockedAt: new Date(Date.now() - 10 * 60_000) });
		await reconcileWarehouseProvisioningJobs();

		expect(projectQueries.deleteProject).toHaveBeenCalledWith('project-abandoned');
		expect(warehouseJobs.get(jobId)).toMatchObject({ status: 'cancelled', lockedBy: null, lockedAt: null });
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('has nothing to cancel when no setup is in progress', async () => {
		await expect(cancelWarehouseProvisioning('user-1')).resolves.toBe(false);
	});

	it('shares a connection test that failed after the latest setup with the agent', async () => {
		vi.mocked(warehouseConnectionCheckQueries.getLatestWarehouseConnectionCheck).mockResolvedValueOnce({
			id: 'check-1',
			userId: 'user-1',
			provider: 'snowflake',
			outcome: 'connection_error',
			error: 'Could not connect. Check Account Identifier.',
			createdAt: new Date(),
		});

		await expect(getOnboardingWarehouseState('user-1', 'chat-1')).resolves.toEqual({
			setup: null,
			failedConnectionTest: { provider: 'snowflake', error: 'Could not connect. Check Account Identifier.' },
		});
	});

	it.each([
		{
			error: new Error('nao init failed: unexpected init output'),
			expected: 'nao init failed. Check the logs for details.',
		},
		{
			error: new Error('nao debug failed: password authentication failed for user "nao"'),
			expected: 'nao debug failed. Check the logs for details.',
		},
		{
			error: new Error('nao sync failed: unexpected sync output'),
			expected: 'nao sync failed. Check the logs for details.',
		},
		{
			error: new Error('nao sync timed out'),
			expected: 'nao sync failed. Check the logs for details.',
		},
		{
			error: new Error('password authentication failed for user "nao"'),
			expected: 'The warehouse rejected these credentials. Check them and try again.',
		},
		{
			error: new Error('Missing package: ibis-framework[postgres] / nao-core[redshift]'),
			expected:
				'The redshift connector is not installed on this nao instance. Ask an administrator to install nao-core[redshift] and restart the service.',
		},
		{
			error: new Error('Unexpected provisioning failure'),
			expected: 'Warehouse setup failed. Check the connection details and try again.',
		},
	])('returns a safe public provisioning error', ({ error, expected }) => {
		expect(getPublicProvisioningError(error)).toBe(expected);
	});
});

function startOnboardingSetup() {
	return startWarehouseProvisioning({
		userId: 'user-1',
		orgId: 'org-1',
		projectName: 'analytics',
		onboardingChatId: 'chat-1',
		provider: 'postgres',
		credentials: { host: 'warehouse.example.com', password: 'secret' },
	});
}

function markJobFailed(jobId: string, changes: Partial<MockWarehouseJob> = {}): MockWarehouseJob {
	const job = warehouseJobs.get(jobId);
	if (!job) {
		throw new Error('Expected provisioning job');
	}
	const failedJob: MockWarehouseJob = {
		...job,
		status: 'failed',
		failedStatus: 'syncing',
		error: 'nao sync failed. Check the logs for details.',
		finishedAt: new Date(),
		...changes,
	};
	warehouseJobs.set(jobId, failedJob);
	return failedJob;
}

function mockSuccessfulProvisioning(projectId: string): string {
	const registeredProjectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'registered-project-test-'));
	vi.mocked(projectQueries.getProjectByOrgAndName).mockResolvedValue(null);
	vi.mocked(createTempProjectDir).mockReturnValue(
		fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-onboarding-test-')),
	);
	vi.mocked(createNewProject).mockResolvedValue({
		projectId,
		projectName: 'analytics',
		status: 'created',
	});
	vi.mocked(projectQueries.getProjectById).mockResolvedValue({
		id: projectId,
		projectName: 'analytics',
		path: registeredProjectDirectory,
	} as never);
	vi.mocked(saveProjectWarehouseEnvVars).mockResolvedValue();
	vi.mocked(generateOnboardingRules).mockResolvedValue();
	vi.mocked(provisionManagedGithubRepository).mockResolvedValue({
		repoFullName: 'nao-org/nao-analytics-project',
		url: 'https://github.com/nao-org/nao-analytics-project',
		created: true,
	});
	vi.mocked(spawn).mockImplementation((_command, args) => {
		const child = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			kill: vi.fn(),
		});
		queueMicrotask(() => {
			child.stdout.emit('data', Buffer.from(`Running nao ${args?.[0]}\n`));
			child.emit('close', 0);
		});
		return child as never;
	});
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					database_config: { type: 'postgres' },
					env_vars: { POSTGRES_PASSWORD: 'secret' },
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		),
	);
	return registeredProjectDirectory;
}
