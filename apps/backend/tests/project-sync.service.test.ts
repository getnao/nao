import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/queries/project-warehouse-credentials.queries', () => ({
	getProjectWarehouseCredentials: vi.fn(),
}));
vi.mock('../src/queries/project.queries', () => ({
	touchProjectUpdatedAt: vi.fn(),
}));
vi.mock('../src/services/project-runtime-env', () => ({
	getProjectRuntimeEnvVars: vi.fn(),
}));
vi.mock('../src/services/managed-github-repository', () => ({
	publishManagedGithubRepositoryUpdate: vi.fn(),
}));
vi.mock('../src/services/nao-command.service', () => ({
	createNaoCommandEnvironment: vi.fn((env) => env),
	runNaoCommand: vi.fn(),
}));
vi.mock('../src/utils/keyed-lock', () => ({
	withKeyedLock: vi.fn((_key, fn) => fn()),
}));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn() },
}));

import type { DBProject } from '../src/db/abstractSchema';
import * as projectQueries from '../src/queries/project.queries';
import * as warehouseCredentialQueries from '../src/queries/project-warehouse-credentials.queries';
import { publishManagedGithubRepositoryUpdate } from '../src/services/managed-github-repository';
import { runNaoCommand } from '../src/services/nao-command.service';
import { getProjectRuntimeEnvVars } from '../src/services/project-runtime-env';
import {
	__resetProjectSyncRunsForTesting,
	getProjectSyncState,
	startProjectSync,
} from '../src/services/project-sync.service';

let projectDirectory: string;
let project: DBProject;

beforeEach(() => {
	vi.clearAllMocks();
	__resetProjectSyncRunsForTesting();
	projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-sync-test-'));
	project = { id: 'project-1', name: 'Sales', path: projectDirectory } as DBProject;
	vi.mocked(warehouseCredentialQueries.getProjectWarehouseCredentials).mockResolvedValue({
		projectId: project.id,
		provider: 'postgres',
		encryptedCredentials: 'encrypted',
	} as never);
	vi.mocked(getProjectRuntimeEnvVars).mockResolvedValue({ POSTGRES_PASSWORD: 'super-secret' });
	vi.mocked(publishManagedGithubRepositoryUpdate).mockResolvedValue({
		repoFullName: 'nao-org/nao-sales-project-1',
		published: true,
	});
});

afterEach(() => {
	fs.rmSync(projectDirectory, { recursive: true, force: true });
});

describe('project sync', () => {
	it('runs a database sync and exposes redacted logs', async () => {
		const existingDatabasesPath = path.join(projectDirectory, 'databases');
		fs.mkdirSync(existingDatabasesPath);
		fs.writeFileSync(path.join(existingDatabasesPath, 'old.txt'), 'old');
		vi.mocked(runNaoCommand).mockImplementation(async (_args, cwd, _env, _timeout, onOutput) => {
			const databasesPath = path.join(cwd, 'databases');
			fs.rmSync(databasesPath, { recursive: true, force: true });
			fs.mkdirSync(databasesPath);
			fs.writeFileSync(path.join(databasesPath, 'new.txt'), 'new');
			await onOutput?.('Connecting with super-secret\n');
		});

		const run = await startProjectSync(project);

		await vi.waitFor(async () => {
			expect((await getProjectSyncState(project)).run?.status).toBe('succeeded');
		});

		const state = await getProjectSyncState(project);
		expect(run.status).toBe('queued');
		expect(state.run?.logs).toContain('Connecting with [REDACTED:POSTGRES_PASSWORD]');
		expect(state.run?.logs).toContain('✓ Published synced context');
		expect(runNaoCommand).toHaveBeenCalledWith(
			['sync', '--provider', 'databases', '--no-render-templates'],
			expect.stringContaining('.project-sync-'),
			{ POSTGRES_PASSWORD: 'super-secret' },
			30 * 60_000,
			expect.any(Function),
		);
		expect(fs.existsSync(path.join(existingDatabasesPath, 'old.txt'))).toBe(false);
		expect(fs.readFileSync(path.join(existingDatabasesPath, 'new.txt'), 'utf8')).toBe('new');
		expect(publishManagedGithubRepositoryUpdate).toHaveBeenCalledWith({
			projectId: project.id,
			projectName: project.name,
			projectDir: projectDirectory,
			paths: ['databases'],
			message: 'Sync database context',
		});
		expect(projectQueries.touchProjectUpdatedAt).toHaveBeenCalledWith(project.id);
	});

	it('keeps the existing database context when publishing fails', async () => {
		const existingFile = path.join(projectDirectory, 'databases', 'existing.txt');
		fs.mkdirSync(path.dirname(existingFile));
		fs.writeFileSync(existingFile, 'existing');
		vi.mocked(runNaoCommand).mockImplementation(async (_args, cwd) => {
			const databasesPath = path.join(cwd, 'databases');
			fs.rmSync(databasesPath, { recursive: true, force: true });
			fs.mkdirSync(databasesPath);
			fs.writeFileSync(path.join(databasesPath, 'new.txt'), 'new');
		});
		vi.mocked(publishManagedGithubRepositoryUpdate).mockRejectedValue(new Error('GitHub push failed'));

		await startProjectSync(project);

		await vi.waitFor(async () => {
			expect((await getProjectSyncState(project)).run?.status).toBe('failed');
		});

		expect(fs.readFileSync(existingFile, 'utf8')).toBe('existing');
		expect(projectQueries.touchProjectUpdatedAt).not.toHaveBeenCalled();
	});

	it('is unavailable without stored warehouse credentials', async () => {
		vi.mocked(warehouseCredentialQueries.getProjectWarehouseCredentials).mockResolvedValue(null);

		await expect(getProjectSyncState(project)).resolves.toMatchObject({
			available: false,
			unavailableReason: 'Database sync is only available for projects created with Connect my data.',
		});
	});
});
