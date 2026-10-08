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
	onboardingChatId: string | null;
	projectId: string | null;
	encryptedCredentials: string | null;
	businessContext: Record<string, string> | null;
	modelSelection: Record<string, string> | null;
	modelProjectId: string | null;
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
			onboardingChatId: null,
			projectId: null,
			encryptedCredentials: null,
			businessContext: null,
			modelSelection: null,
			modelProjectId: null,
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
	getActiveWarehouseProvisioningJobByUser: vi.fn(async (userId: string) => {
		return (
			[...warehouseJobs.values()]
				.reverse()
				.find((job) => job.userId === userId && !['ready', 'failed', 'cancelled'].includes(job.status)) ?? null
		);
	}),
	getLatestWarehouseProvisioningJobByUser: vi.fn(async (userId: string) => {
		return [...warehouseJobs.values()].reverse().find((job) => job.userId === userId) ?? null;
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
	updateWarehouseProvisioningJob: vi.fn(async (jobId: string, changes: Partial<MockWarehouseJob>) => {
		if (controls.failReadyUpdate && changes.status === 'ready') {
			throw new Error('Database unavailable');
		}
		const job = warehouseJobs.get(jobId);
		if (!job) {
			return null;
		}
		const updated = { ...job, ...changes, updatedAt: new Date() };
		warehouseJobs.set(jobId, updated);
		return updated;
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
	listRecoverableWarehouseProvisioningJobs: vi.fn(async (statuses: string[], staleBefore: Date) =>
		[...warehouseJobs.values()].filter(
			(job) => statuses.includes(job.status) && (job.lockedAt === null || job.lockedAt < staleBefore),
		),
	),
}));
vi.mock('../src/utils/project-import.utils', () => ({
	createNewProject: vi.fn(),
	createTempProjectDir: vi.fn(),
}));
vi.mock('../src/services/managed-github-repository', () => ({
	deleteManagedGithubRepository: vi.fn(),
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
import {
	deleteManagedGithubRepository,
	provisionManagedGithubRepository,
} from '../src/services/managed-github-repository';
import { generateOnboardingRules } from '../src/services/onboarding-rules';
import { saveProjectWarehouseEnvVars } from '../src/services/warehouse-credentials';
import {
	getPublicProvisioningError,
	getWarehouseProvisioningJob,
	queueWarehouseFinalization,
	reconcileWarehouseProvisioningJobs,
	startWarehouseProvisioning,
} from '../src/services/warehouse-provisioning';
import { createNewProject, createTempProjectDir } from '../src/utils/project-import.utils';

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
	it('exposes queued job state only to its owner without leaking credentials', async () => {
		vi.useFakeTimers();

		const { jobId, status } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			name: 'analytics',
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
			status: 'queued',
			projectId: null,
			projectName: 'analytics',
			error: null,
		});
		expect(await getWarehouseProvisioningJob(jobId, 'another-user')).toBeNull();
		expect(JSON.stringify(await getWarehouseProvisioningJob(jobId, 'user-1'))).not.toContain('super-secret');
	});

	it('rejects concurrent provisioning jobs for the same user', async () => {
		vi.useFakeTimers();
		const input = {
			userId: 'user-1',
			orgId: 'org-1',
			name: 'analytics',
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

	it('requires a cooldown after a failed provisioning attempt', async () => {
		vi.useFakeTimers();
		const input = {
			userId: 'user-1',
			orgId: 'org-1',
			name: 'analytics',
			provider: 'postgres' as const,
			credentials: { host: 'warehouse.example.com', password: 'secret' },
		};
		const { jobId } = await startWarehouseProvisioning(input);
		const job = warehouseJobs.get(jobId);
		if (!job) {
			throw new Error('Expected provisioning job');
		}
		warehouseJobs.set(jobId, { ...job, status: 'failed', finishedAt: new Date() });

		await expect(startWarehouseProvisioning(input)).rejects.toMatchObject({
			code: 'TOO_MANY_REQUESTS',
		});
	});

	it('rejects provisioning when the user already has a connected project', async () => {
		vi.mocked(projectQueries.listUserProjects).mockResolvedValue([{ id: 'project-1' }] as never);

		await expect(
			startWarehouseProvisioning({
				userId: 'user-1',
				orgId: 'org-1',
				name: 'analytics',
				provider: 'postgres',
				credentials: { host: 'warehouse.example.com', password: 'secret' },
			}),
		).rejects.toMatchObject({ code: 'CONFLICT' });
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
			name: 'analytics',
			path: registeredProjectDirectory,
		} as never);
		vi.mocked(saveProjectWarehouseEnvVars).mockRejectedValue(new Error('Credential storage failed'));
		vi.mocked(projectQueries.deleteProject).mockResolvedValue();
		vi.mocked(scheduledJobQueries.deleteJobByUniqueKey).mockResolvedValue();
		vi.mocked(spawn).mockImplementation(() => {
			const child = Object.assign(new EventEmitter(), {
				stdout: new EventEmitter(),
				stderr: new EventEmitter(),
				kill: vi.fn(),
			});
			queueMicrotask(() => child.emit('close', 0));
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
			name: 'analytics',
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
		expect(scheduledJobQueries.deleteJobByUniqueKey).toHaveBeenCalledWith('context.recommendations:project-1');
		expect(projectQueries.deleteProject).toHaveBeenCalledWith('project-1');
		expect(fs.existsSync(registeredProjectDirectory)).toBe(false);
	});

	it('finalizes in the background after sync and context are both ready', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-2');

		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			name: 'analytics',
			provider: 'postgres',
			credentials: {
				host: 'warehouse.example.com',
				port: 5432,
				database: 'analytics',
				user: 'nao',
				password: 'secret',
			},
		});

		await queueWarehouseFinalization(jobId, 'user-1', {
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
		);
		expect(provisionManagedGithubRepository).toHaveBeenCalledWith({
			projectId: 'project-2',
			projectName: 'analytics',
			projectDir: registeredProjectDirectory,
		});
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('deletes a newly created managed repository when the final database update fails', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-publish-failure');
		controls.failReadyUpdate = true;

		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			name: 'analytics',
			provider: 'postgres',
			credentials: {
				host: 'warehouse.example.com',
				port: 5432,
				database: 'analytics',
				user: 'nao',
				password: 'secret',
			},
		});

		await queueWarehouseFinalization(jobId, 'user-1', {
			businessContext: { additionalContext: 'A bicycle rental company.' },
			modelSelection: { provider: 'openai', modelId: 'gpt-4o-mini' },
			modelProjectId: 'example-project',
		});

		await vi.waitFor(async () => {
			expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('failed');
		});
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
			queueMicrotask(() => child.emit('close', 0));
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
			name: 'analytics',
			provider: 'postgres',
			credentials: { password: 'super-secret' },
		});

		await vi.waitFor(async () => {
			expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('awaiting_context');
		});
		expect(registeredConfig).toContain("env('NAO_ONBOARDING_POSTGRES_PASSWORD')");
		expect(registeredConfig).not.toContain('super-secret');
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('fails and rolls back finalization when the onboarding model is unavailable', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-3');
		vi.mocked(projectQueries.deleteProject).mockResolvedValue();
		vi.mocked(scheduledJobQueries.deleteJobByUniqueKey).mockResolvedValue();

		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			name: 'analytics',
			provider: 'postgres',
			credentials: {
				host: 'warehouse.example.com',
				port: 5432,
				database: 'analytics',
				user: 'nao',
				password: 'secret',
			},
		});

		await queueWarehouseFinalization(jobId, 'user-1', {
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
			name: 'analytics',
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
		expect(spawn).toHaveBeenCalledTimes(2);
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('resumes abandoned finalization from its persisted context', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-finalization-recovery');
		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			name: 'analytics',
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
		);
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it.each([
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
		name: 'analytics',
		path: registeredProjectDirectory,
	} as never);
	vi.mocked(saveProjectWarehouseEnvVars).mockResolvedValue();
	vi.mocked(generateOnboardingRules).mockResolvedValue();
	vi.mocked(provisionManagedGithubRepository).mockResolvedValue({
		repoFullName: 'nao-org/nao-analytics-project',
		url: 'https://github.com/nao-org/nao-analytics-project',
		created: true,
	});
	vi.mocked(spawn).mockImplementation(() => {
		const child = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			kill: vi.fn(),
		});
		queueMicrotask(() => child.emit('close', 0));
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
