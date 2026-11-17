import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/queries/project.queries', () => ({
	getUserRoleInProject: vi.fn(async () => 'admin'),
	getProjectEnvVarsByIdentity: vi.fn(async () => ({
		REPO_URL: 'https://github.com/acme/app.git',
		UNRELATED_API_KEY: 'must-not-enter-the-sandbox',
	})),
}));
vi.mock('../../src/services/warehouse-credentials', () => ({
	getProjectWarehouseEnvVarsByIdentity: vi.fn(async () => ({
		DB_PASSWORD: 'warehouse-secret',
		UNUSED_WAREHOUSE_SECRET: 'must-not-enter-the-sandbox',
	})),
}));

import { getProjectEnvVarsByIdentity, getUserRoleInProject } from '../../src/queries/project.queries';
import { getProjectSyncEnvVars } from '../../src/services/project-runtime-env';
import { getProjectWarehouseEnvVarsByIdentity } from '../../src/services/warehouse-credentials';

let project: string;

beforeEach(() => {
	vi.clearAllMocks();
	project = fs.mkdtempSync(path.join(os.tmpdir(), 'project-sync-env-test-'));
});

afterEach(() => {
	fs.rmSync(project, { recursive: true, force: true });
});

describe('getProjectSyncEnvVars', () => {
	it('returns only credentials referenced by active sync configuration', async () => {
		fs.writeFileSync(
			path.join(project, 'nao_config.yaml'),
			[
				'project_name: demo',
				'databases:',
				'  - name: warehouse',
				'    type: postgres',
				'    host: db.example.com',
				'    password: "{{ env(\'DB_PASSWORD\') }}"',
				'repos:',
				'  - name: app',
				'    url: "{{ env(\'REPO_URL\') }}"',
			].join('\n'),
		);

		await expect(getProjectSyncEnvVars({ id: 'project-1', orgId: 'org-1' }, 'admin-1', project)).resolves.toEqual({
			REPO_URL: 'https://github.com/acme/app.git',
			DB_PASSWORD: 'warehouse-secret',
		});
	});

	it('rejects a user without project-admin ownership before loading credentials', async () => {
		vi.mocked(getUserRoleInProject).mockResolvedValueOnce(null);
		fs.writeFileSync(path.join(project, 'nao_config.yaml'), 'project_name: demo\n');

		await expect(getProjectSyncEnvVars({ id: 'project-2', orgId: 'org-2' }, 'admin-1', project)).rejects.toThrow(
			'Only a project admin can load sync credentials.',
		);
		expect(getProjectEnvVarsByIdentity).not.toHaveBeenCalled();
		expect(getProjectWarehouseEnvVarsByIdentity).not.toHaveBeenCalled();
	});
});
