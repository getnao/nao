import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	class TestRunInputError extends Error {}
	return {
		TestRunInputError,
		deleteJob: vi.fn(),
		deleteJobByUniqueKey: vi.fn(),
		getFirstProjectAdminUserId: vi.fn(),
		getJobByUniqueKey: vi.fn(),
		getUserRoleInProject: vi.fn(),
		listJobsByUniqueKeyPrefix: vi.fn(),
		listProjectFolders: vi.fn(),
		startTestRun: vi.fn(),
		upsertRecurringJob: vi.fn(),
	};
});

vi.mock('../../src/queries/scheduled-job.queries', () => ({
	deleteJob: mocks.deleteJob,
	deleteJobByUniqueKey: mocks.deleteJobByUniqueKey,
	getJobByUniqueKey: mocks.getJobByUniqueKey,
	listJobsByUniqueKeyPrefix: mocks.listJobsByUniqueKeyPrefix,
	upsertRecurringJob: mocks.upsertRecurringJob,
}));
vi.mock('../../src/queries/context-recommendation.queries', () => ({
	getFirstProjectAdminUserId: mocks.getFirstProjectAdminUserId,
}));
vi.mock('../../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
	listProjectFolders: mocks.listProjectFolders,
}));
vi.mock('../../src/services/test-runner.service', () => ({
	startTestRun: mocks.startTestRun,
	TestRunInputError: mocks.TestRunInputError,
}));
vi.mock('../../src/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../src/utils/keyed-lock', () => ({
	withKeyedLock: (_key: string, run: () => Promise<unknown>) => run(),
}));

import {
	createTestSchedule,
	deleteTestSchedule,
	InvalidTestScheduleError,
	listTestSchedules,
	resolveTestScheduleScope,
	runScheduledTests,
	setTestScheduleEnabled,
	syncAllConfiguredTestSchedules,
	updateTestSchedule,
} from '../../src/services/test-schedule.service';
import { useTemporaryFolders } from '../helpers/temporary-folders';

const OWNER = { projectId: 'project-1', userId: 'user-1' };
const RUN = { tags: ['smoke'], models: [{ provider: 'openai' as const, modelId: 'gpt-4.1' }], attempts: 2 };
const APP_JOB = {
	id: 'job-app',
	uniqueKey: 'test-schedule:project-1:schedule-1',
	cron: '0 6 * * *',
	status: 'pending',
	runAt: new Date(2026, 8, 29, 6, 0),
	payload: { ...OWNER, ...RUN },
};

const createTemporaryFolder = useTemporaryFolders();
let projectFolder: string;

describe('test schedules', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 8, 28, 10, 30));
		vi.clearAllMocks();
		projectFolder = createTemporaryFolder('nao-test-schedules-');
		mocks.listJobsByUniqueKeyPrefix.mockResolvedValue([]);
		mocks.getUserRoleInProject.mockResolvedValue('context_admin');
		mocks.getFirstProjectAdminUserId.mockResolvedValue('admin-1');
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('saves a schedule of the app as a recurring job of the project, in the name of who saved it', async () => {
		await createTestSchedule(OWNER, { cron: '0 * * * *', ...RUN });

		expect(mocks.upsertRecurringJob).toHaveBeenCalledWith({
			name: 'test.scheduled-run',
			cron: '0 * * * *',
			uniqueKey: expect.stringMatching(/^test-schedule:project-1:[\w-]{36}$/),
			payload: { ...OWNER, ...RUN, isPaused: false },
			runAt: new Date(2026, 8, 28, 11, 0),
			status: 'pending',
			resetRunAtOnConflict: true,
		});
	});

	it.each([
		{ cron: '*/30 * * * *', jobs: [], message: 'Schedule the tests at most once an hour.' },
		{ cron: '0 6 * * *', jobs: Array(10).fill(APP_JOB), message: 'A project has at most 10 schedules.' },
	])('rejects a new schedule: $message', async ({ cron, jobs, message }) => {
		mocks.listJobsByUniqueKeyPrefix.mockResolvedValue(jobs);

		await expect(createTestSchedule(OWNER, { cron, ...RUN })).rejects.toThrow(
			new InvalidTestScheduleError(message),
		);
		expect(mocks.upsertRecurringJob).not.toHaveBeenCalled();
	});

	it('lists the schedules of the app and of nao_config.yaml, a paused one without a next run', async () => {
		const configKey = await syncConfiguredSchedule('0 2 * * *');
		mocks.listJobsByUniqueKeyPrefix.mockResolvedValue([
			{ ...APP_JOB, status: 'paused' },
			{
				id: 'job-config',
				uniqueKey: configKey,
				cron: '0 2 * * *',
				status: 'pending',
				runAt: new Date(2026, 8, 29, 2, 0),
				payload: { projectId: 'project-1', tags: [], models: null, attempts: null },
			},
		]);

		await expect(listTestSchedules('project-1', projectFolder)).resolves.toEqual([
			{ id: 'schedule-1', source: 'app', cron: '0 6 * * *', isEnabled: false, nextRunAt: null, ...RUN },
			{
				id: configKey.slice('test-schedule:project-1:'.length),
				source: 'config',
				cron: '0 2 * * *',
				isEnabled: true,
				nextRunAt: new Date(2026, 8, 29, 2, 0),
				tags: [],
				models: null,
				attempts: null,
			},
		]);
		expect(mocks.listJobsByUniqueKeyPrefix).toHaveBeenCalledWith('test-schedule:project-1:');
	});

	it('schedules what nao_config.yaml adds and drops what it no longer lists, leaving the app schedules', async () => {
		const removedKey = await syncConfiguredSchedule('0 2 * * *');
		vi.clearAllMocks();
		mocks.listProjectFolders.mockResolvedValue([{ id: 'project-1', path: projectFolder }]);
		mocks.listJobsByUniqueKeyPrefix.mockResolvedValue([
			APP_JOB,
			{ ...APP_JOB, id: 'job-config', uniqueKey: removedKey },
		]);
		writeSchedules('    - cron: 0 3 * * *\n      tags: [smoke]');

		await syncAllConfiguredTestSchedules();

		expect(mocks.deleteJob.mock.calls).toEqual([['job-config']]);
		expect(mocks.upsertRecurringJob).toHaveBeenCalledTimes(1);
		expect(mocks.upsertRecurringJob).toHaveBeenCalledWith(
			expect.objectContaining({
				cron: '0 3 * * *',
				uniqueKey: expect.stringMatching(/^test-schedule:project-1:config-[0-9a-f]{16}$/),
				payload: { projectId: 'project-1', tags: ['smoke'], models: null, attempts: null, isPaused: false },
			}),
		);
	});

	it('keeps the tick of a schedule nao_config.yaml still lists', async () => {
		const configKey = await syncConfiguredSchedule('0 2 * * *');
		vi.clearAllMocks();
		mocks.listJobsByUniqueKeyPrefix.mockResolvedValue([{ ...APP_JOB, id: 'job-config', uniqueKey: configKey }]);

		await listTestSchedules('project-1', projectFolder);

		expect(mocks.upsertRecurringJob).not.toHaveBeenCalled();
		expect(mocks.deleteJob).not.toHaveBeenCalled();
	});

	it.each([
		{ isEnabled: false, status: 'paused' },
		{ isEnabled: true, status: 'pending' },
	])('pauses or resumes a schedule of the app: $status', async ({ isEnabled, status }) => {
		mocks.getJobByUniqueKey.mockResolvedValue(APP_JOB);

		await setTestScheduleEnabled('project-1', 'schedule-1', isEnabled);

		expect(mocks.getJobByUniqueKey).toHaveBeenCalledWith('test-schedule:project-1:schedule-1');
		expect(mocks.upsertRecurringJob).toHaveBeenCalledWith(
			expect.objectContaining({
				uniqueKey: 'test-schedule:project-1:schedule-1',
				cron: '0 6 * * *',
				payload: { ...OWNER, ...RUN, isPaused: !isEnabled },
				runAt: new Date(2026, 8, 29, 6, 0),
				status,
			}),
		);
	});

	it.each([
		{ case: 'running', status: 'pending', isPaused: false, expectedStatus: 'pending' },
		{ case: 'paused', status: 'paused', isPaused: true, expectedStatus: 'paused' },
		{ case: 'paused while its job ran', status: 'pending', isPaused: true, expectedStatus: 'paused' },
	])('edits a schedule of the app $case, which keeps its owner and stays $expectedStatus', async (job) => {
		mocks.getJobByUniqueKey.mockResolvedValue({
			...APP_JOB,
			status: job.status,
			payload: { ...APP_JOB.payload, isPaused: job.isPaused },
		});

		await updateTestSchedule('project-1', 'schedule-1', {
			cron: '30 8 * * 1',
			tags: [],
			models: null,
			attempts: 3,
		});

		expect(mocks.upsertRecurringJob).toHaveBeenCalledWith(
			expect.objectContaining({
				uniqueKey: 'test-schedule:project-1:schedule-1',
				cron: '30 8 * * 1',
				payload: { ...OWNER, tags: [], models: null, attempts: 3, isPaused: job.isPaused },
				runAt: new Date(2026, 9, 5, 8, 30),
				status: job.expectedStatus,
			}),
		);
	});

	it.each([
		{ case: 'an invalid cron', job: APP_JOB, cron: '*/5 * * * *' },
		{
			case: 'a schedule of nao_config.yaml',
			job: { ...APP_JOB, uniqueKey: 'test-schedule:project-1:config-0f' },
			cron: '0 6 * * *',
		},
		{ case: 'a schedule that does not exist', job: null, cron: '0 6 * * *' },
	])('refuses to edit $case', async ({ job, cron }) => {
		mocks.getJobByUniqueKey.mockResolvedValue(job);

		await expect(updateTestSchedule('project-1', 'schedule-1', { cron, ...RUN })).rejects.toBeInstanceOf(
			InvalidTestScheduleError,
		);
		expect(mocks.upsertRecurringJob).not.toHaveBeenCalled();
	});

	it('removes a schedule of the app, but not one of nao_config.yaml', async () => {
		await deleteTestSchedule('project-1', 'schedule-1');
		expect(mocks.deleteJobByUniqueKey.mock.calls).toEqual([['test-schedule:project-1:schedule-1']]);

		await expect(deleteTestSchedule('project-1', 'config-0123456789abcdef')).rejects.toBeInstanceOf(
			InvalidTestScheduleError,
		);
		expect(mocks.deleteJobByUniqueKey).toHaveBeenCalledTimes(1);
	});

	it('starts the run of an app schedule with what it picked, in the name of who saved it', async () => {
		await runScheduledTests({ ...OWNER, ...RUN });

		expect(mocks.startTestRun).toHaveBeenCalledWith({ ...OWNER, ...RUN, isScheduled: true });
	});

	it.each([
		{ case: 'a nao_config.yaml schedule', payload: { projectId: 'project-1' }, role: null },
		{ case: 'a schedule whose owner left the project', payload: OWNER, role: null },
		{ case: 'a schedule whose owner can no longer test the context', payload: OWNER, role: 'user' },
	])('starts the run of $case as a project admin', async ({ payload, role }) => {
		mocks.getUserRoleInProject.mockResolvedValue(role);

		await runScheduledTests({ ...payload, tags: [], models: null, attempts: null });

		expect(mocks.startTestRun).toHaveBeenCalledWith({
			projectId: 'project-1',
			userId: 'admin-1',
			tags: [],
			models: undefined,
			attempts: undefined,
			isScheduled: true,
		});
	});

	it.each([
		{ case: 'who saved it while they can test the context', role: 'admin', ownerId: 'user-1' },
		{ case: 'the project admin who replaces its owner', role: 'user', ownerId: 'admin-1' },
	])('scopes a schedule to $case, so the scheduler pauses it without their seat', async ({ role, ownerId }) => {
		mocks.getUserRoleInProject.mockResolvedValue(role);

		await expect(resolveTestScheduleScope({ ...OWNER, ...RUN })).resolves.toEqual({
			projectId: 'project-1',
			ownerId,
		});
	});

	it('lists as paused, and does not run, a schedule paused while the scheduler was running its job', async () => {
		const pausedPayload = { ...OWNER, ...RUN, isPaused: true };
		mocks.listJobsByUniqueKeyPrefix.mockResolvedValue([{ ...APP_JOB, status: 'pending', payload: pausedPayload }]);

		await expect(listTestSchedules('project-1', projectFolder)).resolves.toEqual([
			expect.objectContaining({ id: 'schedule-1', isEnabled: false, nextRunAt: null }),
		]);
		await runScheduledTests(pausedPayload);

		expect(mocks.startTestRun).not.toHaveBeenCalled();
	});

	it('waits for the next tick when the schedule matches no valid test', async () => {
		mocks.startTestRun.mockRejectedValue(new mocks.TestRunInputError('No tests match the selection.'));

		await expect(runScheduledTests({ ...OWNER, ...RUN })).resolves.toBeUndefined();
	});

	it('fails the job, for the scheduler to retry it, when the run cannot start', async () => {
		mocks.startTestRun.mockRejectedValue(new Error('A test run is already in progress.'));

		await expect(runScheduledTests({ ...OWNER, ...RUN })).rejects.toThrow('A test run is already in progress.');
	});
});

function writeSchedules(schedules: string) {
	fs.writeFileSync(path.join(projectFolder, 'nao_config.yaml'), `test:\n  schedules:\n${schedules}`);
}

/** Writes a schedule to nao_config.yaml and returns the key of the job the sync saves it under. */
async function syncConfiguredSchedule(cron: string): Promise<string> {
	writeSchedules(`    - cron: ${cron}`);
	await listTestSchedules('project-1', projectFolder);
	return mocks.upsertRecurringJob.mock.calls.at(-1)?.[0].uniqueKey;
}
