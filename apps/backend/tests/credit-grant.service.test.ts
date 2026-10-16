import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/env', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/env')>();
	return { ...actual, isCloud: true };
});

vi.mock('../src/db/db', async () => {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');
	const sqliteSchema = await import('../src/db/sqlite-schema');

	const sqlite = new Database(':memory:');
	const statements = await generateSQLiteMigration(
		await generateSQLiteDrizzleJson({}),
		await generateSQLiteDrizzleJson(sqliteSchema),
	);
	for (const statement of statements) {
		sqlite.exec(statement);
	}
	sqlite.pragma('foreign_keys = ON');

	return { db: drizzle(sqlite, { schema: sqliteSchema }) };
});

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getCreditGrant, getCreditSummary } from '../src/queries/credit-wallet.queries';
import * as projectQueries from '../src/queries/project.queries';
import * as userQueries from '../src/queries/user.queries';
import {
	activateUserJoinCandidates,
	reconcileOrganizationSetupGrant,
	reconcileOrganizationSetupGrants,
	recordOrganizationJoinCandidate,
	recordOrganizationSetupCandidate,
	recordProjectJoinCandidate,
} from '../src/services/credit-grant.service';
import * as creditWalletService from '../src/services/credit-wallet.service';
import { logger } from '../src/utils/logger';

const tempDirectories: string[] = [];

describe('automatic credit grants', () => {
	beforeAll(async () => {
		await db.insert(s.creditGrantPolicy).values([
			{ grantType: 'organization_setup', amountMicroUsd: 20_000_000 },
			{ grantType: 'user_join', amountMicroUsd: 5_000_000 },
		]);
	});

	afterAll(() => {
		db.$client.close();
		for (const directory of tempDirectories) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('defers the organization grant until a customer project is configured and awards it once', async () => {
		const projectPath = createProjectDirectory('setup', true);
		await insertOrganizationAndProject('setup-org', 'setup-project', projectPath, {});

		await recordOrganizationSetupCandidate('setup-project');
		expect(await getCreditGrant('organization_setup', 'setup-org')).toBeNull();

		await db
			.update(s.project)
			.set({ envVars: { DATABASE_URL: 'sqlite:///warehouse.db' } })
			.where(eq(s.project.id, 'setup-project'));
		await reconcileOrganizationSetupGrant('setup-project');
		await reconcileOrganizationSetupGrant('setup-project');

		expect(await getCreditSummary('setup-org')).toEqual({
			balanceMicroUsd: 20_000_000,
			lifetimeCreditedMicroUsd: 20_000_000,
			lifetimeDebitedMicroUsd: 0,
		});
		expect(await getCreditGrant('organization_setup', 'setup-org')).toEqual({ orgId: 'setup-org' });
	});

	it('reconciles setup candidates backfilled for existing ready projects', async () => {
		const projectPath = createProjectDirectory('legacy-setup', false);
		await insertOrganizationAndProject('legacy-setup-org', 'legacy-setup-project', projectPath, {});
		await db.insert(s.creditGrantCandidate).values({
			grantType: 'organization_setup',
			orgId: 'legacy-setup-org',
			projectId: 'legacy-setup-project',
			sourceKey: 'project:legacy-setup-project',
		});

		await reconcileOrganizationSetupGrants();

		expect(await getCreditGrant('organization_setup', 'legacy-setup-org')).toEqual({
			orgId: 'legacy-setup-org',
		});
	});

	it('continues past project lookup failures and reconciles once per organization during startup', async () => {
		const firstProjectPath = createProjectDirectory('deduplicated-first', false);
		const secondProjectPath = createProjectDirectory('deduplicated-second', false);
		await insertOrganizationAndProject('deduplicated-org', 'deduplicated-first-project', firstProjectPath, {});
		await db.insert(s.project).values({
			id: 'deduplicated-second-project',
			orgId: 'deduplicated-org',
			name: 'deduplicated-second-project',
			type: 'local',
			path: secondProjectPath,
			envVars: {},
		});
		await db.insert(s.user).values({
			id: 'deduplicated-user',
			name: 'Deduplicated User',
			email: 'deduplicated@example.com',
		});
		await db.insert(s.projectMember).values({
			projectId: 'deduplicated-first-project',
			userId: 'deduplicated-user',
			role: 'user',
		});
		await db.insert(s.creditGrantCandidate).values([
			{
				grantType: 'organization_setup',
				orgId: 'deduplicated-org',
				projectId: 'deduplicated-first-project',
				sourceKey: 'project:deduplicated-first-project',
			},
			{
				grantType: 'organization_setup',
				orgId: 'deduplicated-org',
				projectId: 'deduplicated-second-project',
				sourceKey: 'project:deduplicated-second-project',
			},
			{
				grantType: 'user_join',
				orgId: 'deduplicated-org',
				userId: 'deduplicated-user',
				projectId: 'deduplicated-first-project',
				sourceKey: 'project-member:deduplicated-first-project:deduplicated-user',
				activatedAt: new Date(),
			},
		]);
		const issueGrant = vi.spyOn(creditWalletService, 'issueCreditGrant');
		const getProjectById = projectQueries.getProjectById;
		const candidateProjectIds = new Set(['deduplicated-first-project', 'deduplicated-second-project']);
		let lookupFailed = false;
		vi.spyOn(projectQueries, 'getProjectById').mockImplementation(async (projectId) => {
			if (candidateProjectIds.has(projectId) && !lookupFailed) {
				lookupFailed = true;
				throw new Error('transient project lookup failure');
			}
			return getProjectById(projectId);
		});
		const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

		await reconcileOrganizationSetupGrants();

		expect(errorLog).toHaveBeenCalledWith('Failed to reconcile organization setup grant', {
			source: 'system',
			context: expect.objectContaining({
				orgId: 'deduplicated-org',
				projectId: expect.stringMatching(/^deduplicated-(first|second)-project$/),
			}),
		});
		expect(
			issueGrant.mock.calls.filter(
				([input]) => input.grantType === 'organization_setup' && input.orgId === 'deduplicated-org',
			),
		).toHaveLength(1);
		expect(
			issueGrant.mock.calls.filter(
				([input]) => input.grantType === 'user_join' && input.userId === 'deduplicated-user',
			),
		).toHaveLength(1);
	});

	it('reconciles join grants when another project becomes ready in a funded organization', async () => {
		await insertReadyFundedOrganization('multi-project-org', 'funded-project');
		const projectPath = createProjectDirectory('pending-project', true);
		await db.insert(s.project).values({
			id: 'pending-project',
			orgId: 'multi-project-org',
			name: 'pending-project',
			type: 'local',
			path: projectPath,
			envVars: {},
		});
		await db.insert(s.user).values({
			id: 'pending-project-user',
			name: 'Pending Project User',
			email: 'pending-project@example.com',
		});
		await db.insert(s.projectMember).values({
			projectId: 'pending-project',
			userId: 'pending-project-user',
			role: 'user',
		});
		await recordOrganizationSetupCandidate('pending-project');
		await recordProjectJoinCandidate('pending-project', 'pending-project-user');
		expect(await getCreditGrant('user_join', 'pending-project-user')).toBeNull();

		await db
			.update(s.project)
			.set({ envVars: { DATABASE_URL: 'sqlite:///warehouse.db' } })
			.where(eq(s.project.id, 'pending-project'));
		await reconcileOrganizationSetupGrant('pending-project');

		expect(await getCreditGrant('user_join', 'pending-project-user')).toEqual({ orgId: 'multi-project-org' });
		expect((await getCreditSummary('multi-project-org')).balanceMicroUsd).toBe(25_000_000);
	});

	it('awards an active organization member once they have inherited project access', async () => {
		await insertReadyFundedOrganization('active-org', 'active-project');
		await db.insert(s.user).values({
			id: 'active-user',
			name: 'Active User',
			email: 'active@example.com',
		});
		await db.insert(s.orgMember).values({
			orgId: 'active-org',
			userId: 'active-user',
			role: 'user',
		});

		await recordOrganizationJoinCandidate('active-org', 'active-user');
		await recordOrganizationJoinCandidate('active-org', 'active-user');

		expect(await getCreditGrant('user_join', 'active-user')).toEqual({ orgId: 'active-org' });
		expect((await getCreditSummary('active-org')).balanceMicroUsd).toBe(25_000_000);
	});

	it('keeps a provisioned project member pending until authentication', async () => {
		await insertReadyFundedOrganization('invited-org', 'invited-project');
		await db.insert(s.user).values({
			id: 'invited-user',
			name: 'Invited User',
			email: 'invited@example.com',
			requiresPasswordReset: true,
		});
		await db.insert(s.projectMember).values({
			projectId: 'invited-project',
			userId: 'invited-user',
			role: 'user',
		});

		await recordProjectJoinCandidate('invited-project', 'invited-user');
		expect(await getCreditGrant('user_join', 'invited-user')).toBeNull();

		await activateUserJoinCandidates('invited-user');

		expect(await getCreditGrant('user_join', 'invited-user')).toEqual({ orgId: 'invited-org' });
		expect((await getCreditSummary('invited-org')).balanceMicroUsd).toBe(25_000_000);
	});

	it('rechecks activity after recording a pending join candidate', async () => {
		await insertReadyFundedOrganization('concurrent-org', 'concurrent-project');
		await db.insert(s.user).values({
			id: 'concurrent-user',
			name: 'Concurrent User',
			email: 'concurrent@example.com',
			requiresPasswordReset: true,
		});
		await db.insert(s.projectMember).values({
			projectId: 'concurrent-project',
			userId: 'concurrent-user',
			role: 'user',
		});
		const user = await userQueries.getUser({ id: 'concurrent-user' });
		if (!user) {
			throw new Error('Expected concurrent user to exist.');
		}
		vi.spyOn(userQueries, 'getUser')
			.mockResolvedValueOnce(user)
			.mockResolvedValueOnce({ ...user, requiresPasswordReset: false });

		await recordProjectJoinCandidate('concurrent-project', 'concurrent-user');

		expect(await getCreditGrant('user_join', 'concurrent-user')).toEqual({ orgId: 'concurrent-org' });
	});

	it('reads the current database policy without changing earlier gifts', async () => {
		await insertReadyFundedOrganization('policy-org', 'policy-project');
		await db
			.update(s.creditGrantPolicy)
			.set({ amountMicroUsd: 6_000_000 })
			.where(eq(s.creditGrantPolicy.grantType, 'user_join'));
		await db.insert(s.user).values({
			id: 'later-user',
			name: 'Later User',
			email: 'later@example.com',
		});
		await db.insert(s.orgMember).values({
			orgId: 'policy-org',
			userId: 'later-user',
			role: 'user',
		});

		await recordOrganizationJoinCandidate('policy-org', 'later-user');

		expect(await getCreditGrant('user_join', 'later-user')).toEqual({ orgId: 'policy-org' });
		expect((await getCreditSummary('policy-org')).balanceMicroUsd).toBe(26_000_000);
	});

	it('does not fail the originating operation when grant reconciliation fails', async () => {
		const projectPath = createProjectDirectory('best-effort', false);
		await insertOrganizationAndProject('best-effort-org', 'best-effort-project', projectPath, {});
		await db
			.update(s.creditGrantPolicy)
			.set({ amountMicroUsd: 0 })
			.where(eq(s.creditGrantPolicy.grantType, 'organization_setup'));
		const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

		try {
			await expect(recordOrganizationSetupCandidate('best-effort-project')).resolves.toBeUndefined();
			expect(await getCreditGrant('organization_setup', 'best-effort-org')).toBeNull();
			expect(errorLog).toHaveBeenCalledOnce();
		} finally {
			await db
				.update(s.creditGrantPolicy)
				.set({ amountMicroUsd: 20_000_000 })
				.where(eq(s.creditGrantPolicy.grantType, 'organization_setup'));
		}
	});

	it('logs startup reconciliation lookup failures without rejecting', async () => {
		const lookupError = new Error('lookup failed');
		vi.spyOn(db, 'selectDistinct').mockImplementationOnce(() => {
			throw lookupError;
		});
		const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

		await expect(reconcileOrganizationSetupGrants()).resolves.toBeUndefined();
		expect(errorLog).toHaveBeenCalledWith('Failed to reconcile organization setup grants', {
			source: 'system',
			context: { error: expect.objectContaining({ message: lookupError.message }) },
		});
	});
});

async function insertOrganizationAndProject(
	orgId: string,
	projectId: string,
	projectPath: string,
	envVars: Record<string, string>,
) {
	await db.insert(s.organization).values({ id: orgId, name: orgId, slug: orgId });
	await db.insert(s.project).values({
		id: projectId,
		orgId,
		name: projectId,
		type: 'local',
		path: projectPath,
		envVars,
	});
}

async function insertReadyFundedOrganization(orgId: string, projectId: string): Promise<void> {
	const projectPath = createProjectDirectory(projectId, false);
	await insertOrganizationAndProject(orgId, projectId, projectPath, {});
	await recordOrganizationSetupCandidate(projectId);
}

function createProjectDirectory(name: string, requiresEnvironmentVariable: boolean): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), `nao-credit-${name}-`));
	tempDirectories.push(directory);
	fs.writeFileSync(
		path.join(directory, 'nao_config.yaml'),
		requiresEnvironmentVariable
			? 'project_name: Test\ndatabases:\n  - name: warehouse\n    connection: "{{ env(\'DATABASE_URL\') }}"\n'
			: 'project_name: Test\n',
	);
	return directory;
}
