import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import type { generateOnboardingRules as generateOnboardingRulesTool } from '@nao/shared/tools';
import type { LlmSelectedModel } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import yaml from 'js-yaml';
import { z } from 'zod/v4';

import type { DBWarehouseProvisioningJob, NewWarehouseProvisioningJob } from '../db/abstractSchema';
import { env } from '../env';
import { contextRecommendationsJobUniqueKey } from '../handlers/context-recommendations.handler';
import * as projectQueries from '../queries/project.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import * as warehouseConnectionCheckQueries from '../queries/warehouse-connection-check.queries';
import * as warehouseProvisioningJobQueries from '../queries/warehouse-provisioning-job.queries';
import {
	type OnboardingWarehouseState,
	type ProjectWarehouseCredentials,
	type WarehouseConnectionCheckOutcome,
	type WarehouseConnectionCredentials,
	warehouseConnectionCredentialsSchema,
	warehouseCredentialsSchema,
	type WarehouseProvider,
	type WarehouseProvisioningStatus,
	type WarehouseSetup,
	type WarehouseSetupOutcome,
} from '../types/warehouse';
import { decryptSecret, encryptSecret } from '../utils/encryption';
import { logger, serializeError } from '../utils/logger';
import { createWarehouseLogRedactor, type WarehouseLogRedactor } from '../utils/warehouse-setup';
import {
	deleteManagedGithubRepository,
	getManagedGithubRepositoryFullName,
	provisionManagedGithubRepository,
} from './managed-github-repository';
import { generateOnboardingRules } from './onboarding-rules';
import { reconcileProjectReadiness } from './project.service';
import { createNewProject, createTempProjectDir } from './project-import.service';
import { saveProjectWarehouseEnvVars } from './warehouse-credentials';

const PREPARE_TIMEOUT_MS = 30_000;
const INIT_TIMEOUT_MS = 15 * 60_000;
const DEBUG_TIMEOUT_MS = 5 * 60_000;
const SYNC_TIMEOUT_MS = 30 * 60_000;
const COMMAND_OUTPUT_LIMIT = 8000;
const COMMAND_LOG_UPDATE_MS = 300;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const JOB_LEASE_MS = 5 * 60_000;
const JOB_HEARTBEAT_MS = 30_000;
const JOB_RECONCILIATION_MS = 60_000;
const FAILED_CREDENTIALS_RETENTION_MS = 60 * 60_000;
const SETUP_WAIT_TIMEOUT_MS = 5 * 60_000;
const SETUP_WAIT_POLL_MS = 2_000;
const AGENT_LOGS_LIMIT = 4000;
const MAX_JOB_ATTEMPTS = 5;
const SETUP_IN_PROGRESS_MESSAGE = 'A warehouse connection is already being set up.';
const SETUP_CANCELLED_MESSAGE = 'The warehouse setup was cancelled because the onboarding was restarted.';
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
	'awaiting_context',
	...FINALIZATION_STATUSES,
];
const CONNECTION_VERIFIED_STATUSES: WarehouseProvisioningStatus[] = ['syncing', 'registering', 'awaiting_context'];

interface CommandLogs {
	redactor: WarehouseLogRedactor;
	publish: (logs: string) => Promise<unknown>;
}

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

const persistedCredentialsSchema = z.object({
	version: z.literal(1),
	credentials: warehouseConnectionCredentialsSchema,
});

const warehouseValidationResponseSchema = z.object({
	valid: z.literal(true),
});

class WarehousePreparationError extends Error {}

class WarehouseSetupCancelledError extends Error {
	constructor() {
		super(SETUP_CANCELLED_MESSAGE);
	}
}

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
): Promise<{ valid: true }> {
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

async function requestWarehouseValidation(connection: ProjectWarehouseCredentials): Promise<{ valid: true }> {
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

	return warehouseValidationResponseSchema.parse(await response.json());
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
		signal: AbortSignal.timeout(PREPARE_TIMEOUT_MS),
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
} & ProjectWarehouseCredentials;

type WarehouseProvisioningFinalization = {
	businessContext: generateOnboardingRulesTool.Input['businessContext'];
	modelSelection?: LlmSelectedModel;
	modelProjectId: string;
};

type PublicWarehouseProvisioningJob = Pick<
	DBWarehouseProvisioningJob,
	'id' | 'provider' | 'status' | 'failedStatus' | 'projectId' | 'projectName' | 'logs' | 'error'
> & {
	businessContextProvided: boolean;
	canRetry: boolean;
};

type WarehouseSetupWaitResult = {
	outcome: WarehouseSetupOutcome;
	setup: WarehouseSetup | null;
};

export async function startWarehouseProvisioning(
	input: StartWarehouseProvisioningInput,
): Promise<{ jobId: string; status: 'queued' }> {
	await assertNoWarehouseSetupInProgress(input.userId);

	const connection = warehouseCredentialsSchema.parse({
		provider: input.provider,
		credentials: input.credentials,
	});
	const job = await createQueuedJob({
		id: crypto.randomUUID(),
		userId: input.userId,
		orgId: input.orgId,
		projectName: input.projectName,
		onboardingChatId: input.onboardingChatId,
		provider: connection.provider,
		encryptedCredentials: encryptCredentials(connection.credentials),
	});

	scheduleProvisioningJob(job.id, {
		userId: input.userId,
		orgId: input.orgId,
		projectName: input.projectName,
		...connection,
	});

	return { jobId: job.id, status: 'queued' };
}

/** Restarts the latest stopped setup of an onboarding chat with its stored credentials and business context. */
export async function retryWarehouseProvisioning(
	userId: string,
	onboardingChatId: string,
): Promise<PublicWarehouseProvisioningJob> {
	const previousJob = await warehouseProvisioningJobQueries.getLatestWarehouseProvisioningJob(
		userId,
		onboardingChatId,
	);
	if (!previousJob || !isStoppedStatus(previousJob.status)) {
		throw new TRPCError({ code: 'CONFLICT', message: 'There is no stopped warehouse setup to retry.' });
	}
	if (!previousJob.encryptedCredentials) {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: 'The connection details are no longer stored. Enter them again in the connection form.',
		});
	}
	await assertNoWarehouseSetupInProgress(userId);

	const connection = decryptJobConnection(previousJob);
	const job = await createQueuedJob({
		id: crypto.randomUUID(),
		userId,
		orgId: previousJob.orgId,
		projectName: previousJob.projectName,
		onboardingChatId,
		provider: previousJob.provider,
		encryptedCredentials: previousJob.encryptedCredentials,
		businessContext: previousJob.businessContext,
		modelSelection: previousJob.modelSelection,
		modelProjectId: previousJob.modelProjectId,
	});
	await updateJob(previousJob.id, { encryptedCredentials: null });

	scheduleProvisioningJob(job.id, {
		userId,
		orgId: job.orgId,
		projectName: job.projectName,
		...connection,
	});

	return toPublicWarehouseProvisioningJob(job);
}

/**
 * Cancels the user's setup in progress. A worker still running it stops at its next update and rolls back what it
 * created; a setup no worker holds is rolled back here.
 */
export async function cancelWarehouseProvisioning(userId: string): Promise<boolean> {
	const activeJob = await warehouseProvisioningJobQueries.getActiveWarehouseProvisioningJobByUser(userId);
	if (!activeJob) {
		return false;
	}
	const cancelledJob = await warehouseProvisioningJobQueries.cancelWarehouseProvisioningJob(
		activeJob.id,
		SETUP_CANCELLED_MESSAGE,
	);
	if (!cancelledJob) {
		return false;
	}
	if (!hasLiveLease(cancelledJob)) {
		await cleanUpCancelledJob(cancelledJob.id);
	}
	return true;
}

/**
 * Waits until the setup of an onboarding chat needs the agent: its connection is verified while business
 * context is still missing, it stopped, it is ready, or the wait times out.
 */
export async function waitForWarehouseSetup(
	userId: string,
	onboardingChatId: string,
	abortSignal?: AbortSignal,
): Promise<WarehouseSetupWaitResult> {
	const deadline = Date.now() + SETUP_WAIT_TIMEOUT_MS;
	let job = await warehouseProvisioningJobQueries.getLatestWarehouseProvisioningJob(userId, onboardingChatId);

	while (!getSetupCheckpoint(job) && Date.now() < deadline && !abortSignal?.aborted) {
		await sleep(SETUP_WAIT_POLL_MS, undefined, { signal: abortSignal }).catch(() => undefined);
		job = await warehouseProvisioningJobQueries.getLatestWarehouseProvisioningJob(userId, onboardingChatId);
	}

	return {
		outcome: getSetupCheckpoint(job) ?? 'running',
		setup: job ? toWarehouseSetup(job) : null,
	};
}

/** What the onboarding agent knows about the warehouse setup when a turn starts. */
export async function getOnboardingWarehouseState(
	userId: string,
	onboardingChatId: string,
): Promise<OnboardingWarehouseState> {
	const [job, connectionCheck] = await Promise.all([
		warehouseProvisioningJobQueries.getLatestWarehouseProvisioningJob(userId, onboardingChatId),
		warehouseConnectionCheckQueries.getLatestWarehouseConnectionCheck(userId),
	]);
	const hasUnresolvedFailedTest =
		connectionCheck !== null &&
		connectionCheck.outcome !== 'ok' &&
		(!job || connectionCheck.createdAt > job.createdAt);

	return {
		setup: job ? toWarehouseSetup(job) : null,
		failedConnectionTest: hasUnresolvedFailedTest
			? { provider: connectionCheck.provider, error: connectionCheck.error }
			: null,
	};
}

/** Stores the business context on the chat's latest setup, which finalizes once its metadata is synced. */
export async function submitWarehouseBusinessContext(
	userId: string,
	onboardingChatId: string,
	finalization: WarehouseProvisioningFinalization,
): Promise<{ jobId: string; status: WarehouseProvisioningStatus }> {
	const job = await warehouseProvisioningJobQueries.getLatestWarehouseProvisioningJob(userId, onboardingChatId);
	if (!job) {
		throw new Error('No warehouse setup was started in this conversation.');
	}
	if (job.status === 'ready' || job.status === 'finalizing' || job.status === 'publishing') {
		return { jobId: job.id, status: job.status };
	}

	await updateJob(job.id, {
		businessContext: finalization.businessContext,
		modelSelection: finalization.modelSelection ?? null,
		modelProjectId: finalization.modelProjectId,
	});
	if (isStoppedStatus(job.status)) {
		throw new Error(
			`${job.error ?? 'The warehouse setup failed.'} The business context was saved and will be used when the setup is retried.`,
		);
	}

	await maybeStartFinalization(job.id);
	const updatedJob = await warehouseProvisioningJobQueries.getWarehouseProvisioningJobById(job.id);
	return { jobId: job.id, status: updatedJob?.status ?? job.status };
}

export async function getWarehouseProvisioningJob(
	jobId: string,
	userId: string,
): Promise<PublicWarehouseProvisioningJob | null> {
	const job = await warehouseProvisioningJobQueries.getWarehouseProvisioningJob(jobId, userId);
	return job ? toPublicWarehouseProvisioningJob(job) : null;
}

export async function getActiveWarehouseProvisioningJob(
	userId: string,
	onboardingChatId: string,
): Promise<PublicWarehouseProvisioningJob | null> {
	const job = await warehouseProvisioningJobQueries.getActiveWarehouseProvisioningJob(userId, onboardingChatId);
	return job ? toPublicWarehouseProvisioningJob(job) : null;
}

export async function getLatestWarehouseProvisioningJob(
	userId: string,
	onboardingChatId: string,
): Promise<PublicWarehouseProvisioningJob | null> {
	const job = await warehouseProvisioningJobQueries.getLatestWarehouseProvisioningJob(userId, onboardingChatId);
	return job ? toPublicWarehouseProvisioningJob(job) : null;
}

/** Projects left by a stopped setup are being rolled back, so they do not count as connected. */
export async function hasConnectedProject(userId: string): Promise<boolean> {
	const [projects, stoppedSetupProjectIds] = await Promise.all([
		projectQueries.listUserProjects(userId),
		warehouseProvisioningJobQueries.listStoppedSetupProjectIds(userId),
	]);
	const rolledBackProjectIds = new Set(stoppedSetupProjectIds);
	return projects.some((project) => !rolledBackProjectIds.has(project.id));
}

async function assertNoWarehouseSetupInProgress(userId: string): Promise<void> {
	const activeJob = await warehouseProvisioningJobQueries.getActiveWarehouseProvisioningJobByUser(userId);
	if (activeJob) {
		throw new TRPCError({ code: 'CONFLICT', message: SETUP_IN_PROGRESS_MESSAGE });
	}

	if (await hasConnectedProject(userId)) {
		throw new TRPCError({
			code: 'CONFLICT',
			message: 'Your warehouse project is already connected.',
		});
	}
}

async function createQueuedJob(job: Omit<NewWarehouseProvisioningJob, 'status'>): Promise<DBWarehouseProvisioningJob> {
	try {
		return await warehouseProvisioningJobQueries.createWarehouseProvisioningJob({ ...job, status: 'queued' });
	} catch (error) {
		const activeJob = await warehouseProvisioningJobQueries.getActiveWarehouseProvisioningJobByUser(job.userId);
		if (activeJob) {
			throw new TRPCError({ code: 'CONFLICT', message: SETUP_IN_PROGRESS_MESSAGE });
		}
		throw error;
	}
}

function scheduleProvisioningJob(jobId: string, input: StartWarehouseProvisioningInput): void {
	setImmediate(() => {
		void runProvisioningJob(jobId, input).catch(logReconciliationError);
	});
}

async function runProvisioningJob(
	jobId: string,
	input: StartWarehouseProvisioningInput,
	statuses: WarehouseProvisioningStatus[] = PROVISIONING_STATUSES,
): Promise<void> {
	const job = await claimJob(jobId, statuses);
	if (!job) {
		return;
	}

	await withJobLease(jobId, () => provisionWarehouse(jobId, input));
	await maybeStartFinalization(jobId);
}

function getSetupCheckpoint(job: DBWarehouseProvisioningJob | null): WarehouseSetupOutcome | null {
	if (!job) {
		return 'not_started';
	}
	if (job.status === 'ready' || job.status === 'failed' || job.status === 'cancelled') {
		return job.status;
	}
	if (!job.businessContext && CONNECTION_VERIFIED_STATUSES.includes(job.status)) {
		return 'connection_verified';
	}
	return null;
}

function toPublicWarehouseProvisioningJob(job: DBWarehouseProvisioningJob): PublicWarehouseProvisioningJob {
	return {
		id: job.id,
		provider: job.provider,
		status: job.status,
		failedStatus: job.failedStatus,
		projectId: job.projectId,
		projectName: job.projectName,
		logs: job.logs,
		error: job.error,
		businessContextProvided: Boolean(job.businessContext),
		canRetry: canRetryJob(job),
	};
}

function toWarehouseSetup(job: DBWarehouseProvisioningJob): WarehouseSetup {
	return {
		provider: job.provider,
		status: job.status,
		failedStatus: job.failedStatus,
		error: job.error,
		logs: job.logs ? job.logs.slice(-AGENT_LOGS_LIMIT) : null,
		businessContextProvided: Boolean(job.businessContext),
		canRetry: canRetryJob(job),
	};
}

function canRetryJob(job: DBWarehouseProvisioningJob): boolean {
	return isStoppedStatus(job.status) && job.encryptedCredentials !== null;
}

function isStoppedStatus(status: WarehouseProvisioningStatus): boolean {
	return status === 'failed' || status === 'cancelled';
}

function hasLiveLease(job: DBWarehouseProvisioningJob): boolean {
	return job.lockedAt !== null && job.lockedAt.getTime() > Date.now() - JOB_LEASE_MS;
}

function encryptCredentials(credentials: WarehouseConnectionCredentials): string {
	return encryptSecret(JSON.stringify({ version: 1, credentials }));
}

function decryptJobConnection(job: DBWarehouseProvisioningJob): ProjectWarehouseCredentials {
	if (!job.encryptedCredentials) {
		throw new Error('Warehouse credentials are unavailable');
	}
	const persistedCredentials = persistedCredentialsSchema.parse(JSON.parse(decryptSecret(job.encryptedCredentials)));
	return warehouseCredentialsSchema.parse({
		provider: job.provider,
		credentials: persistedCredentials.credentials,
	});
}

async function provisionWarehouse(jobId: string, input: StartWarehouseProvisioningInput): Promise<void> {
	let projectDir: string | null = null;
	let registeredProjectId: string | null = null;
	let registeredProjectPath: string | null = null;

	try {
		projectDir = createTempProjectDir('warehouse-onboarding');
		await updateJob(jobId, { temporaryDirectory: projectDir });
		const existingProject = await projectQueries.getProjectByOrgAndName(input.orgId, input.projectName);
		if (existingProject) {
			throw new ProjectNameConflictError(input.projectName);
		}

		const provisionConfig = await prepareWarehouseConfig(input.provider, input.credentials);

		await updateJob(jobId, { status: 'initializing' });
		writeWarehouseConfig(projectDir, input.projectName, input.provider, provisionConfig.database_config);
		const commandEnvironment = createCommandEnvironment(provisionConfig.env_vars);
		const commandLogs: CommandLogs = {
			redactor: createWarehouseLogRedactor(provisionConfig.env_vars),
			publish: (logs) => updateJob(jobId, { logs }),
		};
		await runNaoCommand(['init', '--yes'], projectDir, commandEnvironment, INIT_TIMEOUT_MS, commandLogs);

		writeWarehouseConfig(projectDir, input.projectName, input.provider, provisionConfig.database_config);

		await updateJob(jobId, { status: 'debugging', logs: '' });
		await runNaoCommand(['debug'], projectDir, commandEnvironment, DEBUG_TIMEOUT_MS, commandLogs);

		await updateJob(jobId, { status: 'syncing', logs: '' });
		await runNaoCommand(
			['sync', '--provider', 'databases'],
			projectDir,
			commandEnvironment,
			SYNC_TIMEOUT_MS,
			commandLogs,
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

		await saveProjectWarehouseEnvVars(project.projectId, input.provider, provisionConfig.env_vars);

		await updateJob(jobId, {
			status: 'awaiting_context',
			projectId: project.projectId,
			attempts: 0,
			temporaryDirectory: null,
		});
	} catch (error) {
		if (registeredProjectId && registeredProjectPath) {
			await rollbackRegisteredProject(registeredProjectId, registeredProjectPath);
		}
		if (error instanceof WarehouseSetupCancelledError) {
			return;
		}
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
	} finally {
		if (projectDir) {
			fs.rmSync(projectDir, { recursive: true, force: true });
		}
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

		await generateOnboardingRules(
			job.projectId,
			job.businessContext,
			job.modelSelection,
			job.modelProjectId,
			job.userId,
		);

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
		await rollbackRegisteredProject(job.projectId, registeredProjectPath, managedRepository?.repoFullName);
		if (error instanceof WarehouseSetupCancelledError) {
			return;
		}
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
): void {
	const config = yaml.dump({
		project_name: projectName,
		databases: [{ ...databaseConfig, name: provider, templates: ['columns', 'preview'] }],
	});

	fs.writeFileSync(path.join(projectDir, 'nao_config.yaml'), config, { mode: 0o600 });
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
	logs: CommandLogs,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('nao', args, {
			cwd,
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let settled = false;
		let output = '';
		let logUpdate: ReturnType<typeof setTimeout> | undefined;
		let pendingLogUpdate = Promise.resolve<unknown>(undefined);
		const publishOutput = (visibleOutput: string) => {
			pendingLogUpdate = pendingLogUpdate
				.then(() => logs.publish(visibleOutput))
				.catch((error) => {
					if (error instanceof WarehouseSetupCancelledError) {
						stopCommand(error);
						return;
					}
					logger.warn(`Could not publish warehouse command logs: ${String(error)}`, { source: 'system' });
				});
		};
		const stopCommand = (error: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			child.kill('SIGTERM');
			reject(error);
		};
		const flushOutput = async () => {
			if (logUpdate) {
				clearTimeout(logUpdate);
				logUpdate = undefined;
			}
			publishOutput(toVisibleOutput(output));
			await pendingLogUpdate;
		};
		const captureOutput = (chunk: Buffer) => {
			output = logs.redactor.redact(`${output}${chunk.toString('utf8')}`).slice(-COMMAND_OUTPUT_LIMIT);
			if (!logUpdate) {
				logUpdate = setTimeout(() => {
					logUpdate = undefined;
					publishOutput(logs.redactor.withholdPartialSecret(toVisibleOutput(output)));
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
			void flushOutput().finally(() => reject(new Error(`nao ${args[0]} timed out`)));
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
				const details = output.trim();
				reject(new Error(`nao ${args[0]} failed${details ? `: ${details}` : ''}`));
			}
		});
	});
}

function toVisibleOutput(output: string): string {
	return output.replace(ANSI_ESCAPE_PATTERN, '').replaceAll('\r', '\n');
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
	await warehouseProvisioningJobQueries.clearFinishedWarehouseProvisioningCredentials(
		new Date(Date.now() - FAILED_CREDENTIALS_RETENTION_MS),
	);
	const staleBefore = new Date(Date.now() - JOB_LEASE_MS);
	const [jobs, abandonedCancelledJobs] = await Promise.all([
		warehouseProvisioningJobQueries.listRecoverableWarehouseProvisioningJobs(RECOVERABLE_STATUSES, staleBefore),
		warehouseProvisioningJobQueries.listAbandonedCancelledWarehouseProvisioningJobs(staleBefore),
	]);

	await Promise.all(abandonedCancelledJobs.map((job) => cleanUpCancelledJob(job.id)));
	await Promise.all(
		jobs.map(async (job) => {
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

async function recoverProvisioningJob(jobId: string): Promise<void> {
	const job = await claimJob(jobId, PROVISIONING_STATUSES);
	if (!job) {
		return;
	}

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

			const connection = decryptJobConnection(job);

			await updateJob(jobId, {
				status: 'queued',
				projectId: null,
				error: null,
				temporaryDirectory: null,
				finishedAt: null,
			});
			await provisionWarehouse(jobId, {
				userId: job.userId,
				orgId: job.orgId,
				projectName: job.projectName,
				...connection,
			});
		} catch (error) {
			if (error instanceof WarehouseSetupCancelledError) {
				return;
			}
			const serializedError = serializeError(error);
			logger.error('Warehouse provisioning recovery failed', {
				source: 'system',
				context: { jobId, error: serializedError },
			});
			await failJob(jobId, getPublicProvisioningError(error));
		}
	});

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
	await cleanUpStoppedJob(job, job.status);
	await failJob(job.id, 'Warehouse setup stopped unexpectedly several times. Please try again.', {
		lockedBy: null,
		lockedAt: null,
	});
}

/**
 * A worker releases its lock once it has rolled back a cancelled setup, so a cancelled job still holding a lock
 * was left by a worker that stopped before cleaning up.
 */
async function cleanUpCancelledJob(jobId: string): Promise<void> {
	const job = await claimJob(jobId, ['cancelled']);
	if (!job) {
		return;
	}

	await cleanUpStoppedJob(job, job.failedStatus ?? job.status);
	await warehouseProvisioningJobQueries.clearWarehouseProvisioningJobLock(jobId);
}

async function cleanUpStoppedJob(
	job: DBWarehouseProvisioningJob,
	stoppedAtStatus: WarehouseProvisioningStatus,
): Promise<void> {
	if (job.temporaryDirectory) {
		try {
			fs.rmSync(job.temporaryDirectory, { recursive: true, force: true });
		} catch (error) {
			logger.error('Failed to clean up stopped warehouse setup', {
				source: 'system',
				context: { jobId: job.id, error: serializeError(error) },
			});
		}
	}
	if (job.projectId) {
		const managedRepositoryFullName =
			stoppedAtStatus === 'publishing'
				? getManagedGithubRepositoryFullName({ projectId: job.projectId, projectName: job.projectName })
				: null;
		await rollbackRegisteredProject(
			job.projectId,
			path.resolve(env.NAO_PROJECTS_DIR, job.projectId),
			managedRepositoryFullName ?? undefined,
		);
	}
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
	if (persistedJob) {
		return;
	}
	const job = await warehouseProvisioningJobQueries.getWarehouseProvisioningJobById(jobId);
	throw job?.status === 'cancelled' ? new WarehouseSetupCancelledError() : new Error('Warehouse setup job not found');
}

/**
 * Keeps the status the job failed at, so the onboarding funnel knows which step broke, and its encrypted
 * credentials, so the setup can be retried until they are cleared after `FAILED_CREDENTIALS_RETENTION_MS`.
 */
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
	const failedCommand = message.match(/^nao (init|debug|sync) (?:failed|timed out)\b/i)?.[1]?.toLowerCase();
	if (failedCommand) {
		return `nao ${failedCommand} failed. Check the logs for details.`;
	}

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
