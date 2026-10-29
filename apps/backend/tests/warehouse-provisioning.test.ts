import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';
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
	warnings: Array<{ source: 'notion' | 'confluence' | 'github'; message: string }> | null;
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
vi.mock('../src/queries/user.queries', () => ({
	getGithubToken: vi.fn(async () => 'github-secret'),
}));
vi.mock('../src/queries/warehouse-connection-check.queries', () => ({
	createWarehouseConnectionCheck: vi.fn(),
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
			logs: null,
			error: null,
			warnings: null,
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
	releaseStaleWarehouseProvisioningJobContextFileLock: vi.fn(async (jobId: string, staleBefore: Date) => {
		const job = warehouseJobs.get(jobId);
		if (job?.status === 'awaiting_sources' && job.lockedAt && job.lockedAt < staleBefore) {
			warehouseJobs.set(jobId, { ...job, lockedBy: null, lockedAt: null });
		}
	}),
	listRecoverableWarehouseProvisioningJobs: vi.fn(async (statuses: string[], staleBefore: Date) =>
		[...warehouseJobs.values()].filter(
			(job) => statuses.includes(job.status) && (job.lockedAt === null || job.lockedAt < staleBefore),
		),
	),
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
	ONBOARDING_GITHUB_REPOSITORY_URL_ENV: 'NAO_ONBOARDING_GITHUB_REPOSITORY_URL',
	saveProjectWarehouseEnvVars: vi.fn(),
}));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
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
import * as userQueries from '../src/queries/user.queries';
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
	getPublicProvisioningError,
	getWarehouseProvisioningJob,
	queueWarehouseFinalization,
	reconcileWarehouseProvisioningJobs,
	startWarehouseProvisioning,
	submitWarehouseContextSources,
	validateConfluenceContext,
	validateNotionContext,
	validateWarehouseCredentials,
} from '../src/services/warehouse-provisioning';

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

async function submitContextSources(
	jobId: string,
	contextSources: Parameters<typeof submitWarehouseContextSources>[2] = {},
	businessContext: Parameters<typeof submitWarehouseContextSources>[3] = {},
): Promise<void> {
	await vi.waitFor(async () => {
		expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('awaiting_sources');
	});
	await submitWarehouseContextSources(jobId, 'user-1', contextSources, businessContext);
}

describe('warehouse provisioning', () => {
	it('validates credentials before starting provisioning', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					valid: true,
					schemas: [
						{ schema: 'public', tables: ['customers', 'orders'] },
						{ schema: 'warehouse', tables: ['events'] },
					],
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				},
			),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			validateWarehouseCredentials('user-1', {
				provider: 'postgres',
				credentials: { host: 'warehouse.example.com', password: 'secret', schemaName: 'public' },
			}),
		).resolves.toEqual({
			valid: true,
			schemas: [
				{ schema: 'public', tables: ['customers', 'orders'] },
				{ schema: 'warehouse', tables: ['events'] },
			],
		});
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
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ valid: true, schemas: [] })));
		vi.mocked(warehouseConnectionCheckQueries.createWarehouseConnectionCheck).mockRejectedValueOnce(
			new Error('Database unavailable'),
		);

		await expect(
			validateWarehouseCredentials('user-1', { provider: 'postgres', credentials: { host: 'warehouse' } }),
		).resolves.toEqual({ valid: true, schemas: [] });
	});

	it('validates Notion context without exposing its token', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			Response.json({
				valid: true,
				pages: [{ url: 'https://notion.so/page', title: 'Company context' }],
			}),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			validateNotionContext({
				apiKey: 'notion-secret',
				pages: ['https://notion.so/page'],
			}),
		).resolves.toEqual({
			valid: true,
			pages: [{ url: 'https://notion.so/page', title: 'Company context' }],
		});
		expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
			api_key: 'notion-secret',
			pages: ['https://notion.so/page'],
		});
	});

	it('returns the actionable Notion validation error', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					Response.json({ detail: "Add the integration from the page's Connections menu." }, { status: 422 }),
				),
		);

		await expect(
			validateNotionContext({
				apiKey: 'notion-secret',
				pages: ['https://notion.so/page'],
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: "Add the integration from the page's Connections menu.",
		});
	});

	it('validates Confluence context without exposing its token', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			Response.json({
				valid: true,
				pages: [{ url: '123', title: 'Company handbook' }],
			}),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			validateConfluenceContext({
				baseUrl: 'https://acme.atlassian.net/wiki',
				email: 'person@acme.com',
				apiToken: 'atlassian-secret',
				pages: ['123'],
			}),
		).resolves.toEqual({
			valid: true,
			pages: [{ url: '123', title: 'Company handbook' }],
		});
		expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
			base_url: 'https://acme.atlassian.net/wiki',
			email: 'person@acme.com',
			api_token: 'atlassian-secret',
			pages: ['123'],
		});
	});

	it.each([
		'http://acme.atlassian.net/wiki',
		'https://confluence.internal/wiki',
		'https://acme.atlassian.net.attacker.example/wiki',
	])('rejects non-cloud Confluence URL %s', async (baseUrl) => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			validateConfluenceContext({
				baseUrl,
				email: 'person@acme.com',
				apiToken: 'atlassian-secret',
				pages: ['123'],
			}),
		).rejects.toThrow('Enter a Confluence Cloud URL');
		expect(fetchMock).not.toHaveBeenCalled();
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
			projectId: null,
			projectName: 'analytics',
			logs: null,
			error: null,
			warnings: null,
		});
		expect(await getWarehouseProvisioningJob(jobId, 'another-user')).toBeNull();
		expect(JSON.stringify(await getWarehouseProvisioningJob(jobId, 'user-1'))).not.toContain('super-secret');
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

	it('requires a cooldown after a failed provisioning attempt', async () => {
		vi.useFakeTimers();
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
				projectName: 'analytics',
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
			projectName: 'analytics',
			path: registeredProjectDirectory,
		} as never);
		vi.mocked(saveProjectWarehouseEnvVars).mockRejectedValue(new Error('Credential storage failed'));
		vi.mocked(projectQueries.deleteProject).mockResolvedValue();
		vi.mocked(scheduledJobQueries.deleteJobByUniqueKey).mockResolvedValue();
		vi.mocked(spawn).mockImplementation((_command, args, options) => {
			const child = Object.assign(new EventEmitter(), {
				stdout: new EventEmitter(),
				stderr: new EventEmitter(),
				kill: vi.fn(),
			});
			createSyncedTable(args, options?.cwd);
			queueMicrotask(() => {
				child.stdout.emit('data', Buffer.from(`Running nao ${args?.[0]}\n`));
				child.emit('close', 0);
			});
			return child as never;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(
				async () =>
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
		await submitContextSources(jobId);

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

	it('fails before registering a project when no selected tables were synced', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-empty');
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

		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres',
			credentials: { host: 'warehouse.example.com', password: 'secret' },
		});
		await submitContextSources(jobId);

		await vi.waitFor(async () => {
			expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('failed');
		});
		expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.error).toBe(
			'None of the selected tables were synced. They may have been renamed, removed, or become inaccessible.',
		);
		expect(createNewProject).not.toHaveBeenCalled();
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('finalizes in the background after sync and context are both ready', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-2');

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
		await submitContextSources(jobId, {}, { additionalContext: 'A bicycle rental company.' });

		await queueWarehouseFinalization(jobId, 'user-1', {
			businessContext: {},
			modelSelection: { provider: 'openai', modelId: 'gpt-4o-mini' },
			modelProjectId: 'example-project',
		});

		expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('syncing');
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
		expect(reconcileProjectReadiness).toHaveBeenCalledWith('project-2');
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('continues warehouse setup when an optional context source fails to sync', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-context-warning');
		vi.mocked(spawn).mockImplementation((_command, args, options) => {
			const child = Object.assign(new EventEmitter(), {
				stdout: new EventEmitter(),
				stderr: new EventEmitter(),
				kill: vi.fn(),
			});
			createSyncedTable(args, options?.cwd);
			queueMicrotask(() => {
				if (args?.includes('notion')) {
					child.stderr.emit('data', Buffer.from('Notion dependency is unavailable'));
					child.emit('close', 1);
				} else {
					child.stdout.emit('data', Buffer.from(`Running nao ${args?.[0]}\n`));
					child.emit('close', 0);
				}
			});
			return child as never;
		});

		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres',
			credentials: { host: 'warehouse.example.com', password: 'secret' },
		});
		await submitContextSources(jobId, {
			notion: {
				apiKey: 'notion-secret',
				pages: ['https://notion.so/company-context'],
			},
		});

		await vi.waitFor(async () => {
			expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('awaiting_context');
		});
		expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.warnings).toEqual([
			{
				source: 'notion',
				message: 'Notion could not be synced. Warehouse setup continued without it.',
			},
		]);
		expect(createNewProject).toHaveBeenCalledOnce();
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('skips a disconnected GitHub source without failing warehouse setup', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-github-warning');
		let registeredConfig = '';
		vi.mocked(userQueries.getGithubToken).mockResolvedValueOnce(null);
		vi.mocked(createNewProject).mockImplementation(async ({ sourceDir }) => {
			registeredConfig = fs.readFileSync(path.join(sourceDir, 'nao_config.yaml'), 'utf8');
			return {
				projectId: 'project-github-warning',
				projectName: 'analytics',
				status: 'created',
			};
		});

		const { jobId } = await startWarehouseProvisioning({
			userId: 'user-1',
			orgId: 'org-1',
			projectName: 'analytics',
			provider: 'postgres',
			credentials: { host: 'warehouse.example.com', password: 'secret' },
		});
		await submitContextSources(jobId, {
			github: { repoFullName: 'acme/analytics', branch: 'main' },
		});

		await vi.waitFor(async () => {
			expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('awaiting_context');
		});
		expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.warnings).toEqual([
			{
				source: 'github',
				message: 'GitHub was disconnected before its repository could be synced.',
			},
		]);
		expect(registeredConfig).not.toContain('repos:');
		expect(vi.mocked(spawn).mock.calls.map(([, args]) => args)).toEqual([
			['init', '--yes'],
			['debug'],
			['sync', '--provider', 'databases'],
		]);
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('deletes a newly created managed repository when the final database update fails', async () => {
		const registeredProjectDirectory = mockSuccessfulProvisioning('project-publish-failure');
		controls.failReadyUpdate = true;

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
		await submitContextSources(jobId);

		await queueWarehouseFinalization(jobId, 'user-1', {
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
			createSyncedTable(args, options?.cwd);
			queueMicrotask(() => {
				child.stdout.emit(
					'data',
					Buffer.from(
						args?.[0] === 'sync'
							? 'Cloning https://x-access-token:github-secret@github.com/acme/analytics.git\n'
							: `Running nao ${args?.[0]}\n`,
					),
				);
				child.emit('close', 0);
			});
			return child as never;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(
				async () =>
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
			tableSelection: {
				mode: 'selected',
				schemas: ['analytics*'],
				tables: [
					{ schema: 'public', table: 'orders' },
					{ schema: 'sales*', table: 'forecast?' },
				],
			},
		});
		await submitContextSources(jobId, {
			notion: {
				apiKey: 'notion-secret',
				pages: ['https://notion.so/company-context'],
			},
			confluence: {
				baseUrl: 'https://acme.atlassian.net/wiki',
				email: 'person@acme.com',
				apiToken: 'confluence-secret',
				pages: ['123'],
			},
			github: {
				repoFullName: 'acme/analytics',
				branch: 'main',
			},
		});

		await vi.waitFor(async () => {
			expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('awaiting_context');
		});
		expect(warehouseJobs.get(jobId)?.attempts).toBe(0);
		expect(vi.mocked(spawn).mock.calls.map(([, args]) => args)).toEqual([
			['init', '--yes'],
			['debug'],
			['sync', '--provider', 'databases'],
			['sync', '--provider', 'notion'],
			['sync', '--provider', 'confluence'],
			['sync', '--provider', 'repositories'],
		]);
		expect(registeredConfig).toContain('project_name: analytics');
		expect(registeredConfig).toContain('name: postgres');
		expect(registeredConfig).toContain('templates:');
		expect(registeredConfig).toContain('- columns');
		expect(registeredConfig).toContain('- preview');
		expect(registeredConfig).toContain("env('NAO_ONBOARDING_POSTGRES_PASSWORD')");
		expect(registeredConfig).not.toContain('super-secret');
		expect(registeredConfig).toContain("env('NAO_ONBOARDING_NOTION_API_KEY')");
		expect(registeredConfig).not.toContain('notion-secret');
		expect(registeredConfig).toContain("env('NAO_ONBOARDING_CONFLUENCE_API_TOKEN')");
		expect(registeredConfig).not.toContain('confluence-secret');
		expect(registeredConfig).toContain("env('NAO_ONBOARDING_GITHUB_REPOSITORY_URL')");
		expect(registeredConfig).not.toContain('github-secret');
		expect(
			(
				yaml.load(registeredConfig) as {
					databases: Array<{ include: string[] }>;
					notion: { pages: string[] };
				}
			).databases[0]?.include,
		).toEqual(['analytics[*].*', 'public.orders', 'sales[*].forecast[?]']);
		expect(
			(
				yaml.load(registeredConfig) as {
					notion: { pages: string[] };
				}
			).notion.pages,
		).toEqual(['https://notion.so/company-context']);
		expect(
			(
				yaml.load(registeredConfig) as {
					confluence: { base_url: string; deployment: string; email: string; pages: string[] };
				}
			).confluence,
		).toMatchObject({
			base_url: 'https://acme.atlassian.net/wiki',
			deployment: 'cloud',
			email: 'person@acme.com',
			pages: ['123'],
		});
		expect(
			(
				yaml.load(registeredConfig) as {
					repos: Array<{ name: string; url: string; branch: string }>;
				}
			).repos,
		).toEqual([
			{
				name: 'acme-analytics',
				url: "${{ env('NAO_ONBOARDING_GITHUB_REPOSITORY_URL') }}",
				branch: 'main',
			},
		]);
		expect(saveProjectWarehouseEnvVars).toHaveBeenCalledWith(
			'project-safe-config',
			'postgres',
			expect.objectContaining({
				NAO_ONBOARDING_NOTION_API_KEY: '"notion-secret"',
				NAO_ONBOARDING_CONFLUENCE_API_TOKEN: '"confluence-secret"',
				NAO_ONBOARDING_GITHUB_REPOSITORY_URL:
					'"https://x-access-token:github-secret@github.com/acme/analytics.git"',
			}),
			{
				githubConnection: {
					userId: 'user-1',
					repoFullName: 'acme/analytics',
				},
			},
		);
		expect(warehouseJobs.get(jobId)?.logs).toContain('Cloning [REDACTED]');
		expect(warehouseJobs.get(jobId)?.logs).not.toContain('github-secret');
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
			provider: 'postgres',
			credentials: {
				host: 'warehouse.example.com',
				port: 5432,
				database: 'analytics',
				user: 'nao',
				password: 'secret',
			},
		});
		await submitContextSources(jobId);

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

		expect((await getWarehouseProvisioningJob(jobId, 'user-1'))?.status).toBe('awaiting_sources');
		expect(spawn).toHaveBeenCalledTimes(2);
		const temporaryDirectory = warehouseJobs.get(jobId)?.temporaryDirectory;
		if (temporaryDirectory) {
			fs.rmSync(temporaryDirectory, { recursive: true, force: true });
		}
		fs.rmSync(registeredProjectDirectory, { recursive: true, force: true });
	});

	it('releases a stale context-file lock while the temporary project still exists', async () => {
		vi.useFakeTimers();
		const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-onboarding-locked-'));
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
			status: 'awaiting_sources',
			temporaryDirectory,
			lockedBy: 'context-files:abandoned',
			lockedAt: new Date(Date.now() - 5 * 60_000 - 1),
		});

		await reconcileWarehouseProvisioningJobs();

		expect(warehouseJobs.get(jobId)).toMatchObject({
			status: 'awaiting_sources',
			temporaryDirectory,
			lockedBy: null,
			lockedAt: null,
		});
		expect(spawn).not.toHaveBeenCalled();
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	});

	it('recreates a missing temporary project while awaiting context sources', async () => {
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
		const job = warehouseJobs.get(jobId);
		if (!job) {
			throw new Error('Expected provisioning job');
		}
		warehouseJobs.set(jobId, {
			...job,
			status: 'awaiting_sources',
			temporaryDirectory: path.join(os.tmpdir(), `missing-warehouse-onboarding-${crypto.randomUUID()}`),
		});

		await reconcileWarehouseProvisioningJobs();

		const recoveredJob = warehouseJobs.get(jobId);
		expect(recoveredJob).toMatchObject({
			status: 'awaiting_sources',
			attempts: 0,
		});
		expect(recoveredJob?.temporaryDirectory).toBeTruthy();
		expect(fs.existsSync(recoveredJob!.temporaryDirectory!)).toBe(true);
		expect(spawn).toHaveBeenCalledTimes(2);
		fs.rmSync(recoveredJob!.temporaryDirectory!, { recursive: true, force: true });
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
			encryptedCredentials: null,
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
		await submitContextSources(jobId);

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
	vi.mocked(spawn).mockImplementation((_command, args, options) => {
		const child = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			kill: vi.fn(),
		});
		createSyncedTable(args, options?.cwd);
		queueMicrotask(() => {
			child.stdout.emit('data', Buffer.from(`Running nao ${args?.[0]}\n`));
			child.emit('close', 0);
		});
		return child as never;
	});
	vi.stubGlobal(
		'fetch',
		vi.fn().mockImplementation(
			async () =>
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

function createSyncedTable(args: readonly string[] | undefined, cwd: string | URL | undefined): void {
	if (args?.[0] !== 'sync' || !args.includes('databases') || !cwd) {
		return;
	}
	fs.mkdirSync(path.join(String(cwd), 'databases/type=postgres/database=analytics/schema=public/table=orders'), {
		recursive: true,
	});
}
