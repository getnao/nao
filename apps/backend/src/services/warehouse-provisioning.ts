import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { generateOnboardingRules as generateOnboardingRulesTool } from '@nao/shared/tools';
import type { LlmSelectedModel } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import yaml from 'js-yaml';
import { z } from 'zod/v4';

import type { DBWarehouseProvisioningJob } from '../db/abstractSchema';
import { env } from '../env';
import { contextRecommendationsJobUniqueKey } from '../handlers/context-recommendations.handler';
import * as projectQueries from '../queries/project.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import * as userQueries from '../queries/user.queries';
import * as warehouseConnectionCheckQueries from '../queries/warehouse-connection-check.queries';
import * as warehouseProvisioningJobQueries from '../queries/warehouse-provisioning-job.queries';
import {
	type ConfluenceContextSource,
	confluenceContextSourceSchema,
	confluenceContextValidationResultSchema,
	type NotionContextSource,
	notionContextSourceSchema,
	notionContextValidationResultSchema,
	type OnboardingContextSources,
	onboardingContextSourcesSchema,
	type ProjectWarehouseCredentials,
	type WarehouseConnectionCheckOutcome,
	warehouseConnectionCredentialsSchema,
	warehouseCredentialsSchema,
	type WarehouseProvider,
	type WarehouseProvisioningBusinessContext,
	type WarehouseProvisioningStatus,
	type WarehouseProvisioningWarning,
	type WarehouseTableSelection,
	warehouseTableSelectionSchema,
	type WarehouseValidationResult,
	warehouseValidationResultSchema,
} from '../types/warehouse';
import { decryptSecret, encryptSecret } from '../utils/encryption';
import { logger, serializeError } from '../utils/logger';
import { authenticatedRepoUrl } from './github';
import {
	deleteManagedGithubRepository,
	getManagedGithubRepositoryFullName,
	provisionManagedGithubRepository,
} from './managed-github-repository';
import { generateOnboardingRules } from './onboarding-rules';
import { reconcileProjectReadiness } from './project.service';
import { createNewProject, createTempProjectDir } from './project-import.service';
import { cleanupWarehouseContextFiles, restoreWarehouseContextFiles } from './warehouse-context-files';
import { ONBOARDING_GITHUB_REPOSITORY_URL_ENV, saveProjectWarehouseEnvVars } from './warehouse-credentials';

const INIT_TIMEOUT_MS = 15 * 60_000;
const DEBUG_TIMEOUT_MS = 5 * 60_000;
const SYNC_TIMEOUT_MS = 30 * 60_000;
const COMMAND_OUTPUT_LIMIT = 8000;
const COMMAND_LOG_UPDATE_MS = 300;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const JOB_LEASE_MS = 5 * 60_000;
const JOB_HEARTBEAT_MS = 30_000;
const JOB_RECONCILIATION_MS = 60_000;
const FAILED_JOB_COOLDOWN_MS = 30_000;
const MAX_JOB_ATTEMPTS = 5;
const NOTION_API_KEY_ENV = 'NAO_ONBOARDING_NOTION_API_KEY';
const CONFLUENCE_API_TOKEN_ENV = 'NAO_ONBOARDING_CONFLUENCE_API_TOKEN';
const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
const PROVISIONING_STATUSES: WarehouseProvisioningStatus[] = [
	'queued',
	'initializing',
	'debugging',
	'syncing',
	'registering',
];
const FINALIZATION_STATUSES: WarehouseProvisioningStatus[] = ['finalizing', 'publishing'];
const RECOVERABLE_STATUSES: WarehouseProvisioningStatus[] = [
	...PROVISIONING_STATUSES,
	'awaiting_sources',
	'awaiting_context',
	...FINALIZATION_STATUSES,
];

const preparedWarehouseSchema = z.object({
	database_config: z.record(z.string(), z.unknown()),
	env_vars: z.record(z.string(), z.string()),
});

const preparationErrorSchema = z.object({
	detail: z.union([
		z.string(),
		z.object({
			code: z.literal('invalid_warehouse_credentials'),
			fields: z.array(z.string()),
		}),
	]),
});

const warehouseValidationErrorSchema = z.object({
	detail: z.union([
		z.string(),
		z.object({
			code: z.enum(['invalid_warehouse_credentials', 'warehouse_connection_failed']),
			fields: z.array(z.string()),
		}),
	]),
});

const contextValidationErrorSchema = z.object({
	detail: z.string(),
});

const WAREHOUSE_CREDENTIAL_LABELS: Record<string, string> = {
	access_token: 'Access Token',
	account_id: 'Account ID',
	aws_access_key_id: 'AWS Access Key ID',
	aws_secret_access_key: 'AWS Secret Access Key',
	aws_session_token: 'AWS Session Token',
	catalog: 'Catalog',
	client_id: 'Client ID',
	client_secret: 'Client Secret',
	credentials_json: 'Service Account JSON',
	database: 'Database Name',
	dataset_id: 'Dataset ID',
	host: 'Host',
	http_path: 'HTTP Path',
	http_scheme: 'HTTP Scheme',
	location: 'Location',
	password: 'Password',
	port: 'Port',
	project_id: 'GCP Project ID',
	protocol: 'Protocol',
	region_name: 'AWS Region',
	s3_staging_dir: 'S3 Staging Directory',
	schema_name: 'Schema Name',
	server_hostname: 'Server Hostname',
	tenant_id: 'Tenant ID',
	token: 'Access Token',
	user: 'Username',
	username: 'Username',
};

const persistedCredentialsSchema = z.discriminatedUnion('version', [
	z.object({
		version: z.literal(1),
		credentials: warehouseConnectionCredentialsSchema,
	}),
	z.object({
		version: z.literal(2),
		credentials: warehouseConnectionCredentialsSchema,
		tableSelection: warehouseTableSelectionSchema,
	}),
	z.object({
		version: z.literal(3),
		contextSources: onboardingContextSourcesSchema,
		credentials: warehouseConnectionCredentialsSchema,
		tableSelection: warehouseTableSelectionSchema,
	}),
]);

class WarehousePreparationError extends Error {}

class WarehouseValidationError extends Error {
	constructor(
		message: string,
		readonly outcome: Exclude<WarehouseConnectionCheckOutcome, 'ok'>,
	) {
		super(message);
	}
}

export async function validateWarehouseCredentials(
	userId: string,
	input: ProjectWarehouseCredentials,
): Promise<WarehouseValidationResult> {
	const connection = warehouseCredentialsSchema.parse(input);
	try {
		const result = await requestWarehouseValidation(connection);
		await recordConnectionCheck(userId, connection.provider, 'ok');
		return result;
	} catch (error) {
		if (error instanceof WarehouseValidationError) {
			await recordConnectionCheck(userId, connection.provider, error.outcome, error.message);
			throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
		}
		await recordConnectionCheck(
			userId,
			connection.provider,
			'connection_error',
			'The connection could not be checked because the validation service failed.',
		);
		throw error;
	}
}

async function requestWarehouseValidation(connection: ProjectWarehouseCredentials): Promise<WarehouseValidationResult> {
	let response: Response;
	try {
		response = await fetch(`http://localhost:${env.FASTAPI_PORT}/warehouse/validate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Nao-Internal-Secret': env.BETTER_AUTH_SECRET,
			},
			body: JSON.stringify({
				provider: connection.provider,
				credentials: normalizeWarehouseCredentials(connection.provider, connection.credentials),
			}),
			signal: AbortSignal.timeout(30_000),
		});
	} catch (error) {
		if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
			throw new WarehouseValidationError(
				'The warehouse connection timed out. Check the host and port, then try again.',
				'connection_error',
			);
		}
		throw error;
	}

	if (!response.ok) {
		const body = warehouseValidationErrorSchema.safeParse(await response.json().catch(() => null));
		const detail = body.success && typeof body.data.detail !== 'string' ? body.data.detail : null;
		const fields = detail ? [...new Set(detail.fields.map(getWarehouseCredentialLabel))] : [];
		throw new WarehouseValidationError(
			fields.length > 0
				? `Could not connect. Check ${new Intl.ListFormat('en', { type: 'conjunction' }).format(fields)}.`
				: 'The warehouse rejected these credentials. Check them and try again.',
			detail?.code === 'invalid_warehouse_credentials' ? 'missing_credentials' : 'connection_error',
		);
	}

	return warehouseValidationResultSchema.parse(await response.json());
}

export async function validateNotionContext(input: NotionContextSource) {
	const notion = notionContextSourceSchema.parse(input);
	let response: Response;
	try {
		response = await fetch(`http://localhost:${env.FASTAPI_PORT}/context/notion/validate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Nao-Internal-Secret': env.BETTER_AUTH_SECRET,
			},
			body: JSON.stringify({
				api_key: notion.apiKey,
				pages: notion.pages,
			}),
			signal: AbortSignal.timeout(120_000),
		});
	} catch (error) {
		if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'Notion validation timed out. Check the page URLs and try again.',
			});
		}
		throw error;
	}

	if (!response.ok) {
		const body = contextValidationErrorSchema.safeParse(await response.json().catch(() => null));
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: body.success
				? body.data.detail
				: 'Could not access these Notion pages. Check the integration token and page sharing.',
		});
	}

	return notionContextValidationResultSchema.parse(await response.json());
}

export async function validateConfluenceContext(input: ConfluenceContextSource) {
	const confluence = confluenceContextSourceSchema.parse(input);
	let response: Response;
	try {
		response = await fetch(`http://localhost:${env.FASTAPI_PORT}/context/confluence/validate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Nao-Internal-Secret': env.BETTER_AUTH_SECRET,
			},
			body: JSON.stringify({
				base_url: confluence.baseUrl,
				email: confluence.email,
				api_token: confluence.apiToken,
				pages: confluence.pages,
			}),
			signal: AbortSignal.timeout(120_000),
		});
	} catch (error) {
		if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'Confluence validation timed out. Check the site URL and try again.',
			});
		}
		throw error;
	}

	if (!response.ok) {
		const body = contextValidationErrorSchema.safeParse(await response.json().catch(() => null));
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: body.success
				? body.data.detail
				: 'Could not access these Confluence pages. Check the site URL, email, API token, and permissions.',
		});
	}

	return confluenceContextValidationResultSchema.parse(await response.json());
}

/** The onboarding funnel reads these checks; failing to record one must not block the user. */
async function recordConnectionCheck(
	userId: string,
	provider: WarehouseProvider,
	outcome: WarehouseConnectionCheckOutcome,
	error?: string,
): Promise<void> {
	try {
		await warehouseConnectionCheckQueries.createWarehouseConnectionCheck({ userId, provider, outcome, error });
	} catch (recordError) {
		logger.error('Could not record warehouse connection check', {
			source: 'system',
			context: { error: serializeError(recordError) },
		});
	}
}

function getWarehouseCredentialLabel(fieldPath: string): string {
	for (const field of fieldPath.split('.')) {
		const label = WAREHOUSE_CREDENTIAL_LABELS[field];
		if (label) {
			return label;
		}
	}
	return fieldPath.split('.').at(-1)?.replaceAll('_', ' ') ?? fieldPath;
}

async function prepareWarehouseConfig(provider: WarehouseProvider, credentials: object) {
	const response = await fetch(`http://localhost:${env.FASTAPI_PORT}/warehouse/prepare`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Nao-Internal-Secret': env.BETTER_AUTH_SECRET,
		},
		body: JSON.stringify({
			provider,
			credentials: normalizeWarehouseCredentials(provider, credentials),
		}),
	});

	if (!response.ok) {
		const body = preparationErrorSchema.safeParse(await response.json().catch(() => null));
		if (body.success && typeof body.data.detail !== 'string') {
			const fields = body.data.detail.fields
				.map((field) => field.split('.').at(-1)?.replaceAll('_', ' ') ?? field)
				.join(', ');
			throw new WarehousePreparationError(
				fields ? `Some connection details are invalid: ${fields}.` : 'Some connection details are invalid.',
			);
		}
		throw new WarehousePreparationError('Some connection details are missing or invalid.');
	}

	return preparedWarehouseSchema.parse(await response.json());
}

function normalizeWarehouseCredentials(provider: WarehouseProvider, credentials: object): Record<string, unknown> {
	const normalized = toSnakeCaseRecord(credentials);

	if (provider === 'redshift' && isRecord(normalized.ssh_tunnel)) {
		normalized.ssh_tunnel = toSnakeCaseRecord(normalized.ssh_tunnel);
	}

	return normalized;
}

function toSnakeCaseRecord(values: object): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(values).map(([key, value]) => [
			key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
			value,
		]),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type StartWarehouseProvisioningInput = {
	userId: string;
	orgId: string;
	projectName: string;
	onboardingChatId?: string;
	tableSelection?: WarehouseTableSelection;
} & ProjectWarehouseCredentials;

type ProvisionWarehouseInput = StartWarehouseProvisioningInput & {
	contextSources: OnboardingContextSources;
	tableSelection: WarehouseTableSelection;
};

type WarehouseProvisioningFinalization = {
	businessContext: generateOnboardingRulesTool.Input['businessContext'];
	modelSelection?: LlmSelectedModel;
	modelProjectId: string;
};

type PublicWarehouseProvisioningJob = Pick<
	DBWarehouseProvisioningJob,
	'id' | 'provider' | 'status' | 'projectId' | 'projectName' | 'logs' | 'error' | 'warnings'
>;

export async function startWarehouseProvisioning(
	input: StartWarehouseProvisioningInput,
): Promise<{ jobId: string; status: 'queued' }> {
	await assertCanStartWarehouseProvisioning(input.userId);

	const connection = warehouseCredentialsSchema.parse({
		provider: input.provider,
		credentials: input.credentials,
	});

	const validatedInput: ProvisionWarehouseInput = {
		userId: input.userId,
		orgId: input.orgId,
		projectName: input.projectName,
		contextSources: {},
		onboardingChatId: input.onboardingChatId,
		tableSelection: warehouseTableSelectionSchema.parse(input.tableSelection ?? { mode: 'all' }),
		...connection,
	};

	const jobId = crypto.randomUUID();
	const encryptedCredentials = encryptSecret(
		JSON.stringify({
			version: 3,
			contextSources: validatedInput.contextSources,
			credentials: connection.credentials,
			tableSelection: validatedInput.tableSelection,
		}),
	);

	try {
		await warehouseProvisioningJobQueries.createWarehouseProvisioningJob({
			id: jobId,
			userId: input.userId,
			orgId: input.orgId,
			projectName: input.projectName,
			onboardingChatId: input.onboardingChatId,
			provider: connection.provider,
			encryptedCredentials,
			status: 'queued',
		});
	} catch (error) {
		const activeJob = await warehouseProvisioningJobQueries.getActiveWarehouseProvisioningJobByUser(input.userId);
		if (activeJob) {
			throw new TRPCError({
				code: 'CONFLICT',
				message: 'A warehouse connection is already being set up.',
			});
		}
		throw error;
	}

	setImmediate(() => {
		void runProvisioningJob(jobId, validatedInput).catch(logReconciliationError);
	});

	return { jobId, status: 'queued' };
}

async function assertCanStartWarehouseProvisioning(userId: string): Promise<void> {
	const activeJob = await warehouseProvisioningJobQueries.getActiveWarehouseProvisioningJobByUser(userId);
	if (activeJob) {
		throw new TRPCError({
			code: 'CONFLICT',
			message: 'A warehouse connection is already being set up.',
		});
	}

	const projects = await projectQueries.listUserProjects(userId);
	if (projects.length > 0) {
		throw new TRPCError({
			code: 'CONFLICT',
			message: 'Your warehouse project is already connected.',
		});
	}

	const latestJob = await warehouseProvisioningJobQueries.getLatestWarehouseProvisioningJobByUser(userId);
	if (
		latestJob?.finishedAt &&
		(latestJob.status === 'failed' || latestJob.status === 'cancelled') &&
		Date.now() - latestJob.finishedAt.getTime() < FAILED_JOB_COOLDOWN_MS
	) {
		const retryAfterSeconds = Math.ceil(
			(FAILED_JOB_COOLDOWN_MS - (Date.now() - latestJob.finishedAt.getTime())) / 1000,
		);
		throw new TRPCError({
			code: 'TOO_MANY_REQUESTS',
			message: `Please wait ${retryAfterSeconds} seconds before trying again.`,
		});
	}
}

async function runProvisioningJob(
	jobId: string,
	input: ProvisionWarehouseInput,
	statuses: WarehouseProvisioningStatus[] = PROVISIONING_STATUSES,
): Promise<void> {
	const job = await claimJob(jobId, statuses);
	if (!job) {
		return;
	}

	let awaitingContextSources = false;
	await withJobLease(jobId, async () => {
		awaitingContextSources = await provisionWarehouse(jobId, input);
		if (awaitingContextSources) {
			await updateJob(jobId, { status: 'awaiting_sources', attempts: 0 });
		}
	});
	await maybeStartFinalization(jobId);
}

export async function getWarehouseProvisioningJob(
	jobId: string,
	userId: string,
): Promise<PublicWarehouseProvisioningJob | null> {
	const job = await warehouseProvisioningJobQueries.getWarehouseProvisioningJob(jobId, userId);
	if (!job) {
		return null;
	}

	return toPublicWarehouseProvisioningJob(job);
}

export async function getActiveWarehouseProvisioningJob(
	userId: string,
	onboardingChatId: string,
): Promise<PublicWarehouseProvisioningJob | null> {
	const job = await warehouseProvisioningJobQueries.getActiveWarehouseProvisioningJob(userId, onboardingChatId);
	return job ? toPublicWarehouseProvisioningJob(job) : null;
}

function toPublicWarehouseProvisioningJob(job: DBWarehouseProvisioningJob): PublicWarehouseProvisioningJob {
	return {
		id: job.id,
		provider: job.provider,
		status: job.status,
		projectId: job.projectId,
		projectName: job.projectName,
		logs: job.logs,
		error: job.error,
		warnings: job.warnings,
	};
}

export async function queueWarehouseFinalization(
	jobId: string,
	userId: string,
	finalization: WarehouseProvisioningFinalization,
): Promise<void> {
	const job = await warehouseProvisioningJobQueries.getWarehouseProvisioningJob(jobId, userId);
	if (!job) {
		throw new Error('Warehouse setup job not found');
	}
	if (job.status === 'failed' || job.status === 'cancelled') {
		throw new Error(job.error ?? 'Warehouse setup failed');
	}
	if (job.status === 'ready' || job.status === 'finalizing' || job.status === 'publishing') {
		return;
	}

	await updateJob(jobId, {
		businessContext: { ...(job.businessContext ?? {}), ...finalization.businessContext },
		modelSelection: finalization.modelSelection ?? null,
		modelProjectId: finalization.modelProjectId,
	});
	await maybeStartFinalization(jobId);
}

export async function submitWarehouseContextSources(
	jobId: string,
	userId: string,
	contextSources: OnboardingContextSources,
	businessContext: WarehouseProvisioningBusinessContext,
): Promise<void> {
	const job = await warehouseProvisioningJobQueries.getWarehouseProvisioningJob(jobId, userId);
	if (!job) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse setup job not found' });
	}
	if (job.status === 'failed' || job.status === 'cancelled') {
		throw new TRPCError({ code: 'BAD_REQUEST', message: job.error ?? 'Warehouse setup failed' });
	}
	if (job.status !== 'awaiting_sources') {
		if (['syncing', 'registering', 'awaiting_context', 'finalizing', 'publishing', 'ready'].includes(job.status)) {
			return;
		}
		throw new TRPCError({ code: 'CONFLICT', message: 'The warehouse connection is still being verified.' });
	}
	if (!job.encryptedCredentials || !job.temporaryDirectory) {
		throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Warehouse setup cannot be resumed.' });
	}

	const projectDir = job.temporaryDirectory;
	const sources = onboardingContextSourcesSchema.parse(contextSources);
	const persistedCredentials = persistedCredentialsSchema.parse(JSON.parse(decryptSecret(job.encryptedCredentials)));
	const tableSelection =
		persistedCredentials.version === 1 ? { mode: 'all' as const } : persistedCredentials.tableSelection;
	const input: ProvisionWarehouseInput = {
		userId: job.userId,
		orgId: job.orgId,
		projectName: job.projectName,
		contextSources: sources,
		tableSelection,
		provider: job.provider,
		credentials: persistedCredentials.credentials,
	};
	const claimedJob = await claimJob(jobId, ['awaiting_sources']);
	if (!claimedJob) {
		const currentJob = await warehouseProvisioningJobQueries.getWarehouseProvisioningJob(jobId, userId);
		if (currentJob?.status === 'awaiting_sources') {
			throw new TRPCError({
				code: 'CONFLICT',
				message: 'Business context files are still being updated. Try again.',
			});
		}
		return;
	}

	try {
		await updateJob(jobId, {
			status: 'syncing',
			logs: '',
			warnings: [],
			businessContext,
			encryptedCredentials: encryptSecret(
				JSON.stringify({
					version: 3,
					contextSources: sources,
					credentials: input.credentials,
					tableSelection,
				}),
			),
		});
	} catch (error) {
		await warehouseProvisioningJobQueries.releaseWarehouseProvisioningJobLock(jobId, WORKER_ID);
		throw error;
	}

	setImmediate(() => {
		void (async () => {
			await withJobLease(jobId, () => syncWarehouse(jobId, input, projectDir));
			await maybeStartFinalization(jobId);
		})().catch(logReconciliationError);
	});
}

async function provisionWarehouse(
	jobId: string,
	input: ProvisionWarehouseInput,
	pauseForContextSources = true,
): Promise<boolean> {
	let projectDir: string | null = null;
	let preserveTemporaryDirectory = false;

	try {
		projectDir = createTempProjectDir('warehouse-onboarding');
		await updateJob(jobId, { temporaryDirectory: projectDir });
		const existingProject = await projectQueries.getProjectByOrgAndName(input.orgId, input.projectName);
		if (existingProject) {
			throw new ProjectNameConflictError(input.projectName);
		}

		const projectConfig = await prepareProjectConfig(input);

		await updateJob(jobId, { status: 'initializing' });
		writeWarehouseConfig(
			projectDir,
			input.projectName,
			input.provider,
			projectConfig.databaseConfig,
			input.tableSelection,
			projectConfig.contextSources,
		);
		const commandEnvironment = createCommandEnvironment(projectConfig.envVars);
		await runNaoCommand(['init', '--yes'], projectDir, commandEnvironment, INIT_TIMEOUT_MS);

		writeWarehouseConfig(
			projectDir,
			input.projectName,
			input.provider,
			projectConfig.databaseConfig,
			input.tableSelection,
			projectConfig.contextSources,
		);

		await updateJob(jobId, { status: 'debugging', logs: '' });
		await runNaoCommand(['debug'], projectDir, commandEnvironment, DEBUG_TIMEOUT_MS, (logs) =>
			updateJob(jobId, { logs }),
		);

		if (pauseForContextSources) {
			preserveTemporaryDirectory = true;
			return true;
		} else {
			await updateJob(jobId, { status: 'syncing', logs: '' });
			preserveTemporaryDirectory = true;
			await syncWarehouse(jobId, input, projectDir);
		}
	} catch (error) {
		const serializedError = serializeError(error);
		const errorMessage = typeof serializedError.message === 'string' ? serializedError.message : 'Unknown error';
		logger.error(`Warehouse provisioning failed: ${errorMessage}`, {
			source: 'system',
			context: {
				jobId,
				error: serializedError,
			},
		});
		await failJob(jobId, getPublicProvisioningError(error));
		if (projectDir) {
			await cleanupStagedWarehouseContextFiles(jobId, projectDir);
		}
	} finally {
		if (projectDir && !preserveTemporaryDirectory) {
			fs.rmSync(projectDir, { recursive: true, force: true });
		}
	}
	return false;
}

async function syncWarehouse(jobId: string, input: ProvisionWarehouseInput, projectDir: string): Promise<void> {
	let registeredProjectId: string | null = null;
	let registeredProjectPath: string | null = null;

	try {
		const projectConfig = await prepareProjectConfig(input);
		await restoreWarehouseContextFiles(jobId, projectDir);
		writeWarehouseConfig(
			projectDir,
			input.projectName,
			input.provider,
			projectConfig.databaseConfig,
			input.tableSelection,
			projectConfig.contextSources,
		);
		const commandEnvironment = createCommandEnvironment(projectConfig.envVars);
		const publishLogs = createSyncLogPublisher(jobId);
		await updateJob(jobId, { warnings: projectConfig.warnings });
		await runNaoCommand(
			['sync', '--provider', 'databases'],
			projectDir,
			commandEnvironment,
			SYNC_TIMEOUT_MS,
			publishLogs('Database'),
		);
		if (!hasSyncedWarehouseTables(projectDir)) {
			throw new WarehousePreparationError(
				'None of the selected tables were synced. They may have been renamed, removed, or become inaccessible.',
			);
		}
		const warnings = await syncOptionalContextSources(
			jobId,
			projectConfig.contextSources,
			projectDir,
			commandEnvironment,
			projectConfig.warnings,
			publishLogs,
		);

		const projectId = crypto.randomUUID();
		registeredProjectId = projectId;
		registeredProjectPath = path.resolve(env.NAO_PROJECTS_DIR, projectId);
		await updateJob(jobId, { status: 'registering' });
		const project = await createNewProject({
			sourceDir: projectDir,
			projectName: input.projectName,
			orgId: input.orgId,
			projectId,
		});
		registeredProjectId = project.projectId;
		registeredProjectPath = path.resolve(env.NAO_PROJECTS_DIR, project.projectId);
		await updateJob(jobId, { projectId: project.projectId });

		const registeredProject = await projectQueries.getProjectById(project.projectId);
		if (!registeredProject?.path) {
			throw new Error('Created project path is missing');
		}
		registeredProjectPath = registeredProject.path;

		await saveProjectWarehouseEnvVars(project.projectId, input.provider, projectConfig.envVars, {
			...(projectConfig.contextSources.github && {
				githubConnection: {
					userId: input.userId,
					repoFullName: projectConfig.contextSources.github.repoFullName,
				},
			}),
		});

		await updateJob(jobId, {
			status: 'awaiting_context',
			projectId: project.projectId,
			warnings,
			attempts: 0,
			encryptedCredentials: null,
			temporaryDirectory: null,
		});
		await cleanupStagedWarehouseContextFiles(jobId, projectDir);
	} catch (error) {
		const serializedError = serializeError(error);
		const errorMessage = typeof serializedError.message === 'string' ? serializedError.message : 'Unknown error';
		logger.error(`Warehouse provisioning failed: ${errorMessage}`, {
			source: 'system',
			context: {
				jobId,
				error: serializedError,
			},
		});
		if (registeredProjectId && registeredProjectPath) {
			await rollbackRegisteredProject(registeredProjectId, registeredProjectPath);
		}
		await failJob(jobId, getPublicProvisioningError(error));
		await cleanupStagedWarehouseContextFiles(jobId, projectDir);
	} finally {
		fs.rmSync(projectDir, { recursive: true, force: true });
	}
}

function hasSyncedWarehouseTables(projectDir: string): boolean {
	const databasesDir = path.join(projectDir, 'databases');
	if (!fs.existsSync(databasesDir)) {
		return false;
	}

	const directories = [databasesDir];
	while (directories.length > 0) {
		const directory = directories.pop();
		if (!directory) {
			continue;
		}
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}
			if (entry.name.startsWith('table=')) {
				return true;
			}
			directories.push(path.join(directory, entry.name));
		}
	}
	return false;
}

async function prepareProjectConfig(input: ProvisionWarehouseInput): Promise<{
	databaseConfig: Record<string, unknown>;
	envVars: Record<string, string>;
	contextSources: OnboardingContextSources;
	warnings: WarehouseProvisioningWarning[];
}> {
	const provisionConfig = await prepareWarehouseConfig(input.provider, input.credentials);
	const githubToken = input.contextSources.github ? await userQueries.getGithubToken(input.userId) : undefined;
	const { github: requestedGithub, ...nonGithubSources } = input.contextSources;
	const contextSources: OnboardingContextSources =
		requestedGithub && githubToken ? { ...nonGithubSources, github: requestedGithub } : nonGithubSources;
	const warnings =
		requestedGithub && !githubToken
			? [createContextSourceWarning('github', 'GitHub was disconnected before its repository could be synced.')]
			: [];
	const contextEnvVars: Record<string, string> = {
		...(contextSources.notion && {
			[NOTION_API_KEY_ENV]: JSON.stringify(contextSources.notion.apiKey),
		}),
		...(contextSources.confluence && {
			[CONFLUENCE_API_TOKEN_ENV]: JSON.stringify(contextSources.confluence.apiToken),
		}),
		...(contextSources.github &&
			githubToken && {
				[ONBOARDING_GITHUB_REPOSITORY_URL_ENV]: JSON.stringify(
					authenticatedRepoUrl(githubToken, contextSources.github.repoFullName),
				),
			}),
	};
	return {
		databaseConfig: provisionConfig.database_config,
		envVars: { ...provisionConfig.env_vars, ...contextEnvVars },
		contextSources,
		warnings,
	};
}

type ContextSourceName = WarehouseProvisioningWarning['source'];
type SyncLogPublisher = (label: string) => (output: string) => Promise<void>;

async function syncOptionalContextSources(
	jobId: string,
	contextSources: OnboardingContextSources,
	projectDir: string,
	commandEnvironment: NodeJS.ProcessEnv,
	initialWarnings: WarehouseProvisioningWarning[],
	publishLogs: SyncLogPublisher,
): Promise<WarehouseProvisioningWarning[]> {
	const sources: Array<{
		source: ContextSourceName;
		label: string;
		provider: string;
		enabled: boolean;
	}> = [
		{ source: 'notion', label: 'Notion', provider: 'notion', enabled: Boolean(contextSources.notion) },
		{
			source: 'confluence',
			label: 'Confluence',
			provider: 'confluence',
			enabled: Boolean(contextSources.confluence),
		},
		{ source: 'github', label: 'GitHub', provider: 'repositories', enabled: Boolean(contextSources.github) },
	];
	const warnings = [...initialWarnings];

	for (const source of sources.filter(({ enabled }) => enabled)) {
		try {
			await runNaoCommand(
				['sync', '--provider', source.provider],
				projectDir,
				commandEnvironment,
				SYNC_TIMEOUT_MS,
				publishLogs(source.label),
			);
		} catch (error) {
			logger.warn(`${source.label} context sync failed: ${String(error)}`, {
				source: 'system',
				context: { jobId, contextSource: source.source },
			});
			warnings.push(
				createContextSourceWarning(
					source.source,
					`${source.label} could not be synced. Warehouse setup continued without it.`,
				),
			);
			await updateJob(jobId, { warnings });
		}
	}

	return warnings;
}

function createSyncLogPublisher(jobId: string): SyncLogPublisher {
	const outputBySource = new Map<string, string>();
	return (label) => async (output) => {
		outputBySource.set(label, output);
		const logs = [...outputBySource].map(([source, value]) => `## ${source}\n${value}`).join('\n\n');
		await updateJob(jobId, { logs: logs.slice(-COMMAND_OUTPUT_LIMIT) });
	};
}

function createContextSourceWarning(source: ContextSourceName, message: string): WarehouseProvisioningWarning {
	return { source, message };
}

async function cleanupStagedWarehouseContextFiles(jobId: string, projectDir: string): Promise<void> {
	try {
		await cleanupWarehouseContextFiles(jobId, projectDir);
	} catch (error) {
		logger.warn(`Could not clean up staged warehouse context files: ${String(error)}`, {
			source: 'system',
			context: { jobId },
		});
	}
}

async function maybeStartFinalization(jobId: string): Promise<void> {
	const job = await warehouseProvisioningJobQueries.getWarehouseProvisioningJobById(jobId);
	if (!job || job.status !== 'awaiting_context' || !job.projectId || !job.businessContext || !job.modelProjectId) {
		return;
	}
	if (job.attempts >= MAX_JOB_ATTEMPTS) {
		await failExhaustedJob(job);
		return;
	}

	const claimedJob = await claimJob(jobId, ['awaiting_context']);
	if (!claimedJob) {
		return;
	}

	try {
		await updateJob(jobId, { status: 'finalizing' });
	} catch (error) {
		await warehouseProvisioningJobQueries.releaseWarehouseProvisioningJobLock(jobId, WORKER_ID);
		throw error;
	}

	setImmediate(() => {
		void withJobLease(jobId, () => finalizeWarehouseProvisioning(jobId)).catch(logReconciliationError);
	});
}

async function finalizeWarehouseProvisioning(jobId: string): Promise<void> {
	const job = await warehouseProvisioningJobQueries.getWarehouseProvisioningJobById(jobId);
	if (!job || job.status !== 'finalizing' || !job.projectId || !job.businessContext || !job.modelProjectId) {
		return;
	}

	let registeredProjectPath = path.resolve(env.NAO_PROJECTS_DIR, job.projectId);
	let managedRepository: Awaited<ReturnType<typeof provisionManagedGithubRepository>> = null;

	try {
		const registeredProject = await projectQueries.getProjectById(job.projectId);
		if (!registeredProject?.path) {
			throw new Error('Created project path is missing');
		}
		registeredProjectPath = registeredProject.path;

		if (!job.modelSelection) {
			throw new Error('The onboarding model is unavailable');
		}

		await generateOnboardingRules(job.projectId, job.businessContext, job.modelSelection, job.modelProjectId);

		await updateJob(jobId, { status: 'publishing' });
		managedRepository = await provisionManagedGithubRepository({
			projectId: job.projectId,
			projectName: job.projectName,
			projectDir: registeredProjectPath,
		});
		await updateJob(jobId, {
			status: 'ready',
			encryptedCredentials: null,
			temporaryDirectory: null,
			finishedAt: new Date(),
		});
		await reconcileProjectReadiness(job.projectId);
	} catch (error) {
		const serializedError = serializeError(error);
		const errorMessage = typeof serializedError.message === 'string' ? serializedError.message : 'Unknown error';
		logger.error(`Warehouse finalization failed: ${errorMessage}`, {
			source: 'system',
			context: {
				jobId,
				projectId: job.projectId,
				projectName: job.projectName,
				error: serializedError,
			},
		});
		await rollbackRegisteredProject(job.projectId, registeredProjectPath, managedRepository?.repoFullName);
		await failJob(jobId, 'Project setup could not be completed. Please try again.');
	}
}

async function rollbackRegisteredProject(
	projectId: string,
	projectPath: string,
	managedRepositoryFullName?: string,
): Promise<void> {
	const cleanupErrors: unknown[] = [];

	if (managedRepositoryFullName) {
		try {
			await deleteManagedGithubRepository(managedRepositoryFullName);
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	try {
		await scheduledJobQueries.deleteJobByUniqueKey(contextRecommendationsJobUniqueKey(projectId));
	} catch (error) {
		cleanupErrors.push(error);
	}
	try {
		await projectQueries.deleteProject(projectId);
	} catch (error) {
		cleanupErrors.push(error);
	}
	try {
		fs.rmSync(projectPath, { recursive: true, force: true });
	} catch (error) {
		cleanupErrors.push(error);
	}

	if (cleanupErrors.length > 0) {
		logger.error('Failed to fully roll back warehouse project', {
			source: 'system',
			context: {
				projectId,
				errors: cleanupErrors.map(serializeError),
			},
		});
	}
}

function writeWarehouseConfig(
	projectDir: string,
	projectName: string,
	provider: WarehouseProvider,
	databaseConfig: Record<string, unknown>,
	tableSelection: WarehouseTableSelection,
	contextSources: OnboardingContextSources,
): void {
	const include =
		tableSelection.mode === 'selected'
			? [
					...new Set([
						...(tableSelection.schemas ?? []).map((schema) => `${escapeGlob(schema)}.*`),
						...tableSelection.tables.map(
							({ schema, table }) => `${escapeGlob(schema)}.${escapeGlob(table)}`,
						),
					]),
				]
			: undefined;
	const config = yaml.dump({
		project_name: projectName,
		databases: [
			{ ...databaseConfig, name: provider, templates: ['columns', 'preview'], ...(include && { include }) },
		],
		...(contextSources.notion && {
			notion: {
				api_key: `\${{ env('${NOTION_API_KEY_ENV}') }}`,
				pages: contextSources.notion.pages,
			},
		}),
		...(contextSources.confluence && {
			confluence: {
				base_url: contextSources.confluence.baseUrl,
				deployment: 'cloud',
				email: contextSources.confluence.email,
				api_token: `\${{ env('${CONFLUENCE_API_TOKEN_ENV}') }}`,
				pages: contextSources.confluence.pages,
			},
		}),
		...(contextSources.github && {
			repos: [
				{
					name: contextSources.github.repoFullName.replace('/', '-'),
					url: `\${{ env('${ONBOARDING_GITHUB_REPOSITORY_URL_ENV}') }}`,
					branch: contextSources.github.branch,
				},
			],
		}),
	});

	fs.writeFileSync(path.join(projectDir, 'nao_config.yaml'), config, { mode: 0o600 });
}

function escapeGlob(value: string): string {
	return value.replaceAll('[', '[[]').replaceAll('*', '[*]').replaceAll('?', '[?]');
}

function createCommandEnvironment(warehouseEnvVars: Record<string, string>): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		TMPDIR: process.env.TMPDIR,
		VIRTUAL_ENV: process.env.VIRTUAL_ENV,
		LANG: process.env.LANG,
		LC_ALL: process.env.LC_ALL,
		SSL_CERT_FILE: process.env.SSL_CERT_FILE,
		REQUESTS_CA_BUNDLE: process.env.REQUESTS_CA_BUNDLE,
		HTTPS_PROXY: process.env.HTTPS_PROXY,
		HTTP_PROXY: process.env.HTTP_PROXY,
		NO_PROXY: process.env.NO_PROXY,
		...warehouseEnvVars,
	};
}

function runNaoCommand(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
	timeoutMs: number,
	onOutput?: (output: string) => Promise<unknown>,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('nao', args, {
			cwd,
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let settled = false;
		let output = '';
		const redactOutput = createOutputRedactor(env);
		let logUpdate: ReturnType<typeof setTimeout> | undefined;
		let pendingLogUpdate = Promise.resolve<unknown>(undefined);
		const publishOutput = () => {
			if (!onOutput) {
				return;
			}
			const visibleOutput = redactOutput(output).replace(ANSI_ESCAPE_PATTERN, '').replaceAll('\r', '\n');
			pendingLogUpdate = pendingLogUpdate
				.then(() => onOutput(visibleOutput))
				.catch((error) =>
					logger.warn(`Could not publish warehouse command logs: ${String(error)}`, { source: 'system' }),
				);
		};
		const flushOutput = async () => {
			if (logUpdate) {
				clearTimeout(logUpdate);
				logUpdate = undefined;
			}
			publishOutput();
			await pendingLogUpdate;
		};
		const captureOutput = (chunk: Buffer) => {
			output = `${output}${chunk.toString('utf8')}`.slice(-COMMAND_OUTPUT_LIMIT);
			if (onOutput && !logUpdate) {
				logUpdate = setTimeout(() => {
					logUpdate = undefined;
					publishOutput();
				}, COMMAND_LOG_UPDATE_MS);
			}
		};
		child.stdout.on('data', captureOutput);
		child.stderr.on('data', captureOutput);
		const timeout = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			child.kill('SIGTERM');
			void flushOutput().finally(() => reject(new Error('nao command timed out')));
		}, timeoutMs);

		child.once('error', async (error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			await flushOutput();
			reject(new Error(`Could not start nao ${args[0]}: ${error.message}`));
		});
		child.once('close', async (code) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			await flushOutput();
			if (code === 0) {
				resolve();
			} else {
				const details = redactOutput(output).trim();
				reject(new Error(`nao ${args[0]} failed${details ? `: ${details}` : ''}`));
			}
		});
	});
}

function createOutputRedactor(env: NodeJS.ProcessEnv): (output: string) => string {
	const secrets = Object.entries(env)
		.filter(([key, value]) => key.startsWith('NAO_ONBOARDING_') && value)
		.flatMap(([, value]) => {
			try {
				const parsed = JSON.parse(value!);
				return typeof parsed === 'string' ? [value!, parsed] : [value!];
			} catch {
				return [value!];
			}
		})
		.filter((value) => value.length >= 4)
		.sort((left, right) => right.length - left.length);

	return (output) => secrets.reduce((redacted, secret) => redacted.replaceAll(secret, '[REDACTED]'), output);
}

let reconcilerStarted = false;

export function startWarehouseProvisioningReconciler(): void {
	if (reconcilerStarted) {
		return;
	}
	reconcilerStarted = true;

	void reconcileWarehouseProvisioningJobs().catch(logReconciliationError);
	const interval = setInterval(() => {
		void reconcileWarehouseProvisioningJobs().catch(logReconciliationError);
	}, JOB_RECONCILIATION_MS);
	interval.unref?.();
}

export async function reconcileWarehouseProvisioningJobs(): Promise<void> {
	const staleBefore = new Date(Date.now() - JOB_LEASE_MS);
	const jobs = await warehouseProvisioningJobQueries.listRecoverableWarehouseProvisioningJobs(
		RECOVERABLE_STATUSES,
		staleBefore,
	);

	await Promise.all(
		jobs.map(async (job) => {
			if (job.status === 'awaiting_sources') {
				if (!job.temporaryDirectory || !fs.existsSync(job.temporaryDirectory)) {
					await recoverProvisioningJob(job.id, ['awaiting_sources']);
				} else {
					await warehouseProvisioningJobQueries.releaseStaleWarehouseProvisioningJobContextFileLock(
						job.id,
						staleBefore,
					);
				}
				return;
			}
			if (job.status !== 'awaiting_context' && job.attempts >= MAX_JOB_ATTEMPTS) {
				await failExhaustedJob(job);
				return;
			}
			if (PROVISIONING_STATUSES.includes(job.status)) {
				await recoverProvisioningJob(job.id);
				return;
			}
			if (job.status === 'awaiting_context') {
				await maybeStartFinalization(job.id);
				return;
			}
			await recoverFinalizationJob(job.id);
		}),
	);
}

async function recoverProvisioningJob(
	jobId: string,
	statuses: WarehouseProvisioningStatus[] = PROVISIONING_STATUSES,
): Promise<void> {
	const job = await claimJob(jobId, statuses);
	if (!job) {
		return;
	}
	const resumeSync = job.status === 'syncing' || job.status === 'registering';
	let awaitingContextSources = false;

	await withJobLease(jobId, async () => {
		try {
			if (job.temporaryDirectory) {
				fs.rmSync(job.temporaryDirectory, { recursive: true, force: true });
			}

			if (job.projectId) {
				const registeredProject = await projectQueries.getProjectById(job.projectId);
				await rollbackRegisteredProject(
					job.projectId,
					registeredProject?.path ?? path.resolve(env.NAO_PROJECTS_DIR, job.projectId),
				);
			}

			if (!job.encryptedCredentials) {
				throw new Error('Warehouse credentials are unavailable');
			}
			const persistedCredentials = persistedCredentialsSchema.parse(
				JSON.parse(decryptSecret(job.encryptedCredentials)),
			);
			const connection = warehouseCredentialsSchema.parse({
				provider: job.provider,
				credentials: persistedCredentials.credentials,
			});
			const tableSelection =
				persistedCredentials.version === 1 ? { mode: 'all' as const } : persistedCredentials.tableSelection;
			const contextSources = persistedCredentials.version === 3 ? persistedCredentials.contextSources : {};

			await updateJob(jobId, {
				status: 'queued',
				projectId: null,
				error: null,
				temporaryDirectory: null,
				finishedAt: null,
			});
			awaitingContextSources = await provisionWarehouse(
				jobId,
				{
					userId: job.userId,
					orgId: job.orgId,
					projectName: job.projectName,
					contextSources,
					tableSelection,
					...connection,
				},
				!resumeSync,
			);
		} catch (error) {
			const serializedError = serializeError(error);
			logger.error('Warehouse provisioning recovery failed', {
				source: 'system',
				context: { jobId, error: serializedError },
			});
			await failJob(jobId, getPublicProvisioningError(error));
		}
	});
	if (awaitingContextSources) {
		await updateJob(jobId, { status: 'awaiting_sources', attempts: 0 });
	}

	await maybeStartFinalization(jobId);
}

async function recoverFinalizationJob(jobId: string): Promise<void> {
	const job = await claimJob(jobId, FINALIZATION_STATUSES);
	if (!job) {
		return;
	}

	await withJobLease(jobId, async () => {
		await updateJob(jobId, { status: 'finalizing' });
		await finalizeWarehouseProvisioning(jobId);
	});
}

async function failExhaustedJob(job: DBWarehouseProvisioningJob): Promise<void> {
	if (job.temporaryDirectory) {
		await cleanupStagedWarehouseContextFiles(job.id, job.temporaryDirectory);
		try {
			fs.rmSync(job.temporaryDirectory, { recursive: true, force: true });
		} catch (error) {
			logger.error('Failed to clean up exhausted warehouse setup', {
				source: 'system',
				context: { jobId: job.id, error: serializeError(error) },
			});
		}
	}
	if (job.projectId) {
		const managedRepositoryFullName =
			job.status === 'publishing'
				? getManagedGithubRepositoryFullName({ projectId: job.projectId, projectName: job.projectName })
				: null;
		await rollbackRegisteredProject(
			job.projectId,
			path.resolve(env.NAO_PROJECTS_DIR, job.projectId),
			managedRepositoryFullName ?? undefined,
		);
	}
	await failJob(job.id, 'Warehouse setup stopped unexpectedly several times. Please try again.', {
		lockedBy: null,
		lockedAt: null,
	});
}

async function claimJob(
	jobId: string,
	statuses: WarehouseProvisioningStatus[],
): Promise<DBWarehouseProvisioningJob | null> {
	return warehouseProvisioningJobQueries.claimWarehouseProvisioningJob(
		jobId,
		WORKER_ID,
		statuses,
		new Date(Date.now() - JOB_LEASE_MS),
	);
}

async function withJobLease(jobId: string, operation: () => Promise<void>): Promise<void> {
	const heartbeat = setInterval(() => {
		void warehouseProvisioningJobQueries
			.renewWarehouseProvisioningJobLock(jobId, WORKER_ID)
			.catch(logReconciliationError);
	}, JOB_HEARTBEAT_MS);
	heartbeat.unref?.();

	try {
		await operation();
	} finally {
		clearInterval(heartbeat);
		await warehouseProvisioningJobQueries.releaseWarehouseProvisioningJobLock(jobId, WORKER_ID);
	}
}

function logReconciliationError(error: unknown): void {
	logger.error('Warehouse provisioning reconciliation failed', {
		source: 'system',
		context: { error: serializeError(error) },
	});
}

async function updateJob(
	jobId: string,
	update: warehouseProvisioningJobQueries.WarehouseProvisioningJobChanges,
): Promise<void> {
	const persistedJob = await warehouseProvisioningJobQueries.updateWarehouseProvisioningJob(jobId, update);
	if (!persistedJob) {
		throw new Error('Warehouse setup job not found');
	}
}

/** Keeps the status the job failed at, so the onboarding funnel knows which step broke. */
async function failJob(
	jobId: string,
	error: string,
	changes: warehouseProvisioningJobQueries.WarehouseProvisioningJobChanges = {},
): Promise<void> {
	const job = await warehouseProvisioningJobQueries.getWarehouseProvisioningJobById(jobId);
	await updateJob(jobId, {
		...changes,
		status: 'failed',
		failedStatus: job?.status ?? null,
		error,
		encryptedCredentials: null,
		temporaryDirectory: null,
		finishedAt: new Date(),
	});
}

class ProjectNameConflictError extends Error {
	constructor(projectName: string) {
		super(`A project named "${projectName}" already exists.`);
	}
}

export function getPublicProvisioningError(error: unknown): string {
	if (error instanceof ProjectNameConflictError) {
		return error.message;
	}

	if (error instanceof WarehousePreparationError) {
		return error.message;
	}

	const message = error instanceof Error ? error.message : String(error);
	const connector = message.match(/nao-core\[([^\]]+)\]/i)?.[1];

	if (connector && /missing package|no module named|module not found/i.test(message)) {
		return `The ${connector} connector is not installed on this nao instance. Ask an administrator to install nao-core[${connector}] and restart the service.`;
	}

	if (
		/password authentication failed|authentication failed|access denied for user|login failed for user|invalid credentials|unauthorized/i.test(
			message,
		)
	) {
		return 'The warehouse rejected these credentials. Check them and try again.';
	}

	return 'Warehouse setup failed. Check the connection details and try again.';
}
