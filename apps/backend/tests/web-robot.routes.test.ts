import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	archiveWebRobot: vi.fn(),
	authorWebRobotRecipeFromUrl: vi.fn(),
	cancelQueuedWebRobotRun: vi.fn(),
	createWebRobot: vi.fn(),
	createWebRobotRun: vi.fn(),
	deleteJob: vi.fn(),
	enqueueOnceJob: vi.fn(),
	findActiveWebRobotRun: vi.fn(),
	getEnvVars: vi.fn(),
	getWebRobot: vi.fn(),
	getWebRobotById: vi.fn(),
	getWebRobotRun: vi.fn(),
	inspectWebRobotUrl: vi.fn(),
	listActiveWebRobotRuns: vi.fn(),
	listProjectDatasetDirectory: vi.fn(),
	listWebRobotRuns: vi.fn(),
	listWebRobots: vi.fn(),
	previewWebRobotRepair: vi.fn(),
	readProjectDataset: vi.fn(),
	requestCancellation: vi.fn(),
	requestWebRobotRunCancel: vi.fn(),
	runWebRobotRecipe: vi.fn(),
	setWebRobotRunScheduledJob: vi.fn(),
	updateWebRobot: vi.fn(),
	upsertRecurringJob: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));

vi.mock('../src/env', () => ({
	env: { BETA_WEB_ROBOTS_ENABLED: true },
}));

vi.mock('../src/queries/project.queries', () => ({
	getEnvVars: mocks.getEnvVars,
	getProjectByUserId: vi.fn(async () => ({
		id: 'project-id',
		name: 'Test project',
		path: '/tmp/nao-project',
		envVars: {},
	})),
	getUserRoleInProject: vi.fn(async () => 'admin'),
}));

vi.mock('../src/queries/scheduled-job.queries', () => ({
	deleteJob: mocks.deleteJob,
	enqueueOnceJob: mocks.enqueueOnceJob,
	upsertRecurringJob: mocks.upsertRecurringJob,
}));

vi.mock('../src/queries/web-robot.queries', () => ({
	archiveWebRobot: mocks.archiveWebRobot,
	cancelQueuedWebRobotRun: mocks.cancelQueuedWebRobotRun,
	createWebRobot: mocks.createWebRobot,
	createWebRobotRun: mocks.createWebRobotRun,
	findActiveWebRobotRun: mocks.findActiveWebRobotRun,
	getWebRobot: mocks.getWebRobot,
	getWebRobotById: mocks.getWebRobotById,
	getWebRobotRun: mocks.getWebRobotRun,
	listActiveWebRobotRuns: mocks.listActiveWebRobotRuns,
	listWebRobotRuns: mocks.listWebRobotRuns,
	listWebRobots: mocks.listWebRobots,
	requestWebRobotRunCancel: mocks.requestWebRobotRunCancel,
	setWebRobotRunScheduledJob: mocks.setWebRobotRunScheduledJob,
	updateWebRobot: mocks.updateWebRobot,
}));

vi.mock('../src/handlers/web-robot.handler', () => ({
	requestWebRobotCancellation: mocks.requestCancellation,
	WEB_ROBOT_JOB_NAME: 'web_robot.run',
	webRobotJobUniqueKey: (robotId: string) => `web_robot:${robotId}`,
}));

vi.mock('../src/services/cron-nlp', () => ({
	naturalLanguageToCron: vi.fn(async () => '0 2 * * *'),
}));

vi.mock('../src/services/scheduler.service', () => ({
	nextCronTick: vi.fn(() => new Date('2026-01-01T02:00:00.000Z')),
}));

vi.mock('../src/services/storage', () => ({
	isStorageEnabled: vi.fn(() => true),
	STORAGE_DISABLED_MESSAGE: 'Storage is disabled.',
}));

vi.mock('../src/services/storage/project-datasets', () => ({
	listProjectDatasetDirectory: mocks.listProjectDatasetDirectory,
	readProjectDataset: mocks.readProjectDataset,
}));

vi.mock('../src/services/web-scraper', () => ({
	inspectWebRobotUrl: mocks.inspectWebRobotUrl,
	runWebRobotRecipe: mocks.runWebRobotRecipe,
}));

vi.mock('../src/services/web-robot-authoring', () => ({
	authorWebRobotRecipeFromUrl: mocks.authorWebRobotRecipeFromUrl,
}));

vi.mock('../src/services/web-robot-authoring/repair', () => ({
	previewWebRobotRepair: mocks.previewWebRobotRepair,
}));

vi.mock('../src/services/sso-group-mapping.service', () => ({
	isGroupRoleMappingActive: vi.fn(async () => false),
}));

import { router } from '../src/trpc/trpc';
import { webRobotRoutes } from '../src/trpc/web-robot.routes';

const testRouter = router(webRobotRoutes);

const recipe = {
	version: 1,
	allowedHosts: ['example.com'],
	request: { delayMs: 0 },
	stages: [
		{
			id: 'products',
			source: { type: 'api', url: 'https://example.com/products' },
			extract: { type: 'json', itemsPath: 'items', fields: { sku: { path: 'sku' } } },
			output: 'product',
		},
	],
} as const;

const robot = {
	id: 'robot-id',
	projectId: 'project-id',
	userId: 'user-id',
	name: 'Catalog',
	slug: 'catalog',
	description: null,
	definition: recipe,
	definitionVersion: 1,
	definitionHash: 'hash_1',
	scheduledJobId: null,
	lastSuccessfulRunId: null,
	lastSuccessfulRunAt: null,
	lastPublishedProductCount: null,
	archivedAt: null,
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
	updatedAt: new Date('2026-01-01T00:00:00.000Z'),
	cron: null,
	enabled: false,
	scheduledJob: null,
};

const queuedRun = {
	id: 'run-id',
	robotId: robot.id,
	scheduledJobId: 'manual-job-id',
	triggeredByUserId: 'user-id',
	trigger: 'manual',
	status: 'queued',
	definition: recipe,
	definitionHash: 'hash_1',
	stats: {},
	errorMessage: null,
	artifactPrefix: null,
	cancelRequestedAt: null,
	queuedAt: new Date('2026-01-01T00:00:00.000Z'),
	startedAt: null,
	completedAt: null,
};

describe('web robot routes', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getEnvVars.mockResolvedValue({ API_TOKEN: 'secret' });
		mocks.createWebRobot.mockResolvedValue(robot);
		mocks.getWebRobot.mockResolvedValue(robot);
		mocks.getWebRobotById.mockResolvedValue(robot);
		mocks.getWebRobotRun.mockResolvedValue(queuedRun);
		mocks.listWebRobots.mockResolvedValue([]);
		mocks.findActiveWebRobotRun.mockResolvedValue(null);
		mocks.createWebRobotRun.mockResolvedValue(queuedRun);
		mocks.enqueueOnceJob.mockResolvedValue({ id: 'manual-job-id' });
		mocks.upsertRecurringJob.mockResolvedValue({ id: 'job-id' });
	});

	it('creates a robot and links its recurring schedule', async () => {
		const caller = createCaller();

		const created = await caller.create({
			name: 'Catalog',
			slug: 'catalog',
			recipe,
			cron: '0 2 * * *',
			enabled: true,
		});

		expect(created.id).toBe('robot-id');
		expect(mocks.createWebRobot).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'project-id',
				userId: 'user-id',
				name: 'Catalog',
				slug: 'catalog',
				definitionVersion: 1,
			}),
		);
		expect(mocks.upsertRecurringJob).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'web_robot.run',
				cron: '0 2 * * *',
				uniqueKey: 'web_robot:robot-id',
				status: 'pending',
			}),
		);
		expect(mocks.updateWebRobot).toHaveBeenCalledWith('project-id', 'robot-id', { scheduledJobId: 'job-id' });
	});

	it('creates a manual robot from a validated URL and queues one run', async () => {
		mocks.authorWebRobotRecipeFromUrl.mockResolvedValue({
			status: 'ready',
			recipe,
			score: 91,
			sampleProducts: [{ product_key: 'key:1', sku: 'SKU-1' }],
			warnings: [],
			diagnostics: {
				discovery: {
					url: 'https://example.com/products',
					finalUrl: 'https://example.com/products',
					allowedHosts: ['example.com'],
					title: 'Example products',
					counts: {
						api: 1,
						endpoint: 0,
						jsonLd: 0,
						embedded: 0,
						dom: 0,
						detail: 1,
						pagination: 1,
						actions: 0,
					},
					pagination: [],
					actions: [],
					endpoints: [],
					blockers: [],
				},
				candidates: [],
			},
		});
		const caller = createCaller();

		const result = await caller.createFromUrl({ url: 'https://example.com/products' });

		expect(result).toMatchObject({
			status: 'created',
			robot: { id: 'robot-id', cron: null, enabled: false },
			run: { id: 'run-id', status: 'queued' },
		});
		expect(mocks.createWebRobot).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Example products',
				slug: 'example-products',
				definition: expect.objectContaining({ allowedHosts: ['example.com'] }),
			}),
		);
		expect(mocks.enqueueOnceJob).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'web_robot.run', payload: { webRobotId: 'robot-id', runId: 'run-id' } }),
		);
	});

	it('rejects URL authoring without creating a robot when no recipe passes', async () => {
		mocks.authorWebRobotRecipeFromUrl.mockResolvedValue({
			status: 'rejected',
			reason: 'No generated recipe passed the bounded dry-run quality gate.',
			warnings: [],
			diagnostics: {
				discovery: {
					url: 'https://example.com',
					finalUrl: 'https://example.com',
					allowedHosts: ['example.com'],
					counts: {
						api: 0,
						endpoint: 0,
						jsonLd: 0,
						embedded: 0,
						dom: 0,
						detail: 0,
						pagination: 0,
						actions: 0,
					},
					pagination: [],
					actions: [],
					endpoints: [],
					blockers: [],
				},
				candidates: [],
			},
		});
		const caller = createCaller();

		const result = await caller.createFromUrl({ url: 'https://example.com' });

		expect(result.status).toBe('rejected');
		expect(mocks.createWebRobot).not.toHaveBeenCalled();
		expect(mocks.enqueueOnceJob).not.toHaveBeenCalled();
	});

	it('exports and imports versioned robot definitions', async () => {
		mocks.getWebRobot.mockResolvedValue({ ...robot, cron: '0 2 * * *', enabled: true });
		const caller = createCaller();

		const exported = await caller.exportRobot({ id: robot.id });
		expect(exported).toMatchObject({
			format: 'nao-web-robot',
			formatVersion: 1,
			slug: 'catalog',
			cron: '0 2 * * *',
			enabled: true,
			recipe,
		});

		await caller.importRobot({
			robot: {
				name: exported.name,
				slug: 'catalog-copy',
				recipe: exported.recipe,
				cron: exported.cron,
				enabled: false,
			},
		});
		expect(mocks.createWebRobot).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Catalog', slug: 'catalog-copy', userId: 'user-id' }),
		);
		expect(mocks.upsertRecurringJob).toHaveBeenCalledWith(
			expect.objectContaining({ cron: '0 2 * * *', status: 'paused' }),
		);
	});

	it('previews a repair from a partial run', async () => {
		const partialRun = { ...queuedRun, status: 'partial', errorMessage: 'Site layout changed.' };
		mocks.getWebRobotRun.mockResolvedValue(partialRun);
		mocks.previewWebRobotRepair.mockResolvedValue({
			status: 'ready',
			recipe,
			score: 88,
			sampleProducts: [],
			warnings: [],
			diagnostics: {
				discovery: {
					url: 'https://example.com/products',
					finalUrl: 'https://example.com/products',
					allowedHosts: ['example.com'],
					counts: {
						api: 1,
						endpoint: 0,
						jsonLd: 0,
						embedded: 0,
						dom: 0,
						detail: 0,
						pagination: 0,
						actions: 0,
					},
					pagination: [],
					actions: [],
					endpoints: [],
					blockers: [],
				},
				candidates: [],
			},
			sourceUrl: 'https://example.com/products',
			currentDefinitionHash: 'hash_1',
			proposedDefinitionHash: 'hash_2',
			changes: [{ kind: 'extract', stageId: 'products', message: "Stage 'products' extraction changed." }],
		});

		const result = await createCaller().previewRepair({ id: robot.id, runId: partialRun.id });

		expect(result).toMatchObject({
			status: 'ready',
			sourceUrl: 'https://example.com/products',
			currentDefinitionHash: 'hash_1',
			proposedDefinitionHash: 'hash_2',
		});
		expect(mocks.previewWebRobotRepair).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'project-id',
				currentRecipe: robot.definition,
				runRecipe: partialRun.definition,
				env: { API_TOKEN: 'secret' },
			}),
		);
	});

	it('applies a repair only when the current definition hash matches', async () => {
		const repaired = {
			...recipe,
			stages: [
				{
					...recipe.stages[0],
					source: { type: 'api', url: 'https://example.com/api/products' },
				},
			],
		};
		mocks.updateWebRobot.mockResolvedValue({
			...robot,
			definition: repaired,
			definitionHash: 'hash_2',
		});
		mocks.getWebRobotById.mockResolvedValue({
			...robot,
			definition: repaired,
			definitionHash: 'hash_2',
		});

		const result = await createCaller().applyRepair({
			id: robot.id,
			expectedDefinitionHash: 'hash_1',
			recipe: repaired,
		});

		expect(result).toMatchObject({
			previousDefinitionHash: 'hash_1',
			definitionHash: 'hash_2',
			robot: { definitionHash: 'hash_2' },
		});
		expect(mocks.updateWebRobot).toHaveBeenCalledWith(
			'project-id',
			robot.id,
			expect.objectContaining({ definition: expect.objectContaining({ allowedHosts: ['example.com'] }) }),
		);

		await expect(
			createCaller().applyRepair({ id: robot.id, expectedDefinitionHash: 'stale', recipe: repaired }),
		).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('rejects repair recipes that expand the host scope', async () => {
		const expanded = { ...recipe, allowedHosts: ['example.com', 'other.example'] };

		await expect(
			createCaller().applyRepair({ id: robot.id, expectedDefinitionHash: 'hash_1', recipe: expanded }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.updateWebRobot).not.toHaveBeenCalled();
	});

	it('returns run artifact files and manifest diagnostics', async () => {
		mocks.getWebRobotRun.mockResolvedValue({
			...queuedRun,
			status: 'completed',
			artifactPrefix: '/datasets/catalog/versions/run-id',
		});
		mocks.listProjectDatasetDirectory.mockResolvedValue([
			{
				name: 'products.parquet',
				relativePath: 'catalog/versions/run-id/products.parquet',
				type: 'file',
				size: 10,
			},
		]);
		mocks.readProjectDataset.mockImplementation(async (_projectId: string, path: string) =>
			path.endsWith('manifest.json') ? JSON.stringify({ runId: 'run-id', published: true }) : '# Catalog\n',
		);

		const result = await createCaller().getRunArtifacts({ runId: 'run-id' });

		expect(result.files[0]?.path).toBe('/datasets/catalog/versions/run-id/products.parquet');
		expect(result.manifest).toMatchObject({ runId: 'run-id', published: true });
		expect(result.readme).toContain('# Catalog');
	});

	it('rejects invalid cron expressions before writing', async () => {
		await expect(
			createCaller().create({ name: 'Catalog', recipe, cron: 'not a cron', enabled: true }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.createWebRobot).not.toHaveBeenCalled();
	});

	it('runs a recipe dry-run with project env vars', async () => {
		mocks.runWebRobotRecipe.mockResolvedValue({ stats: { itemsExtracted: 1 }, products: [] });
		const caller = createCaller();

		const result = await caller.testRecipe({ recipe });

		expect(mocks.getEnvVars).toHaveBeenCalledWith('project-id');
		expect(mocks.runWebRobotRecipe).toHaveBeenCalledWith(
			expect.objectContaining({ dryRun: true, env: { API_TOKEN: 'secret' } }),
		);
		expect(result.stats.itemsExtracted).toBe(1);
	});

	it('queues a manual run and records the one-off job', async () => {
		mocks.findActiveWebRobotRun.mockResolvedValue(null);
		mocks.createWebRobotRun.mockResolvedValue(queuedRun);
		mocks.enqueueOnceJob.mockResolvedValue({ id: 'manual-job-id' });

		const result = await createCaller().runNow({ id: robot.id });

		expect(result?.id).toBe('run-id');
		expect(mocks.createWebRobotRun).toHaveBeenCalledWith(
			expect.objectContaining({ robotId: robot.id, trigger: 'manual', triggeredByUserId: 'user-id' }),
		);
		expect(mocks.enqueueOnceJob).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'web_robot.run',
				uniqueKey: 'web-robot-manual:run-id',
				payload: { webRobotId: robot.id, runId: 'run-id' },
			}),
		);
		expect(mocks.setWebRobotRunScheduledJob).toHaveBeenCalledWith('run-id', 'manual-job-id');
	});

	it('rejects a manual run while another run is active', async () => {
		mocks.findActiveWebRobotRun.mockResolvedValue(queuedRun);

		await expect(createCaller().runNow({ id: robot.id })).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(mocks.createWebRobotRun).not.toHaveBeenCalled();
	});

	it('cancels queued manual runs and removes their one-off job', async () => {
		const result = await createCaller().cancelRun({ runId: queuedRun.id });

		expect(mocks.deleteJob).toHaveBeenCalledWith('manual-job-id');
		expect(mocks.cancelQueuedWebRobotRun).toHaveBeenCalledWith('run-id');
		expect(result?.id).toBe('run-id');
	});

	it('requests cancellation for running runs', async () => {
		mocks.getWebRobotRun.mockResolvedValue({ ...queuedRun, status: 'running' });

		await createCaller().cancelRun({ runId: queuedRun.id });

		expect(mocks.requestWebRobotRunCancel).toHaveBeenCalledWith('run-id');
		expect(mocks.requestCancellation).toHaveBeenCalledWith('run-id');
		expect(mocks.deleteJob).not.toHaveBeenCalled();
	});

	it('archives a robot after cancelling active runs and its schedule', async () => {
		mocks.getWebRobot.mockResolvedValue({ ...robot, scheduledJobId: 'schedule-job-id' });
		mocks.listActiveWebRobotRuns.mockResolvedValue([
			{ ...queuedRun, scheduledJobId: 'manual-job-id' },
			{ ...queuedRun, id: 'run-2', scheduledJobId: null, status: 'running' },
		]);

		await expect(createCaller().archive({ id: robot.id })).resolves.toEqual({ success: true });

		expect(mocks.deleteJob).toHaveBeenCalledWith('manual-job-id');
		expect(mocks.cancelQueuedWebRobotRun).toHaveBeenCalledWith('run-id');
		expect(mocks.requestWebRobotRunCancel).toHaveBeenCalledWith('run-2');
		expect(mocks.requestCancellation).toHaveBeenCalledWith('run-2');
		expect(mocks.deleteJob).toHaveBeenCalledWith('schedule-job-id');
		expect(mocks.archiveWebRobot).toHaveBeenCalledWith('project-id', robot.id);
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: {
			user: {
				id: 'user-id',
				name: 'Test User',
				email: 'test@example.com',
			},
		},
		selectedProjectId: 'project-id',
	} as never);
}
