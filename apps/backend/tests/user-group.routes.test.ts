import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createUserGroup: vi.fn(),
	getUserGroupOverview: vi.fn(),
	getDatabaseContextCatalog: vi.fn(),
	getDocsContextCatalog: vi.fn(),
	hasFeature: vi.fn(),
	resolveEffectiveUserGroupAccess: vi.fn(),
	role: 'admin' as 'admin' | 'user' | 'viewer',
	updateUserGroup: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/agents/user-rules', () => ({
	getDatabaseContextCatalog: mocks.getDatabaseContextCatalog,
}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project', path: '/project' })),
	getUserRoleInProject: vi.fn(async () => mocks.role),
}));
vi.mock('../src/queries/user-group.queries', () => ({
	UserGroupQueryError: class UserGroupQueryError extends Error {},
	createUserGroup: mocks.createUserGroup,
	deleteUserGroup: vi.fn(),
	getUserGroupOverview: mocks.getUserGroupOverview,
	resolveEffectiveUserGroupAccess: mocks.resolveEffectiveUserGroupAccess,
	setUserGroupMembership: vi.fn(),
	updateUserGroup: mocks.updateUserGroup,
}));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { userGroups: 'user-groups' },
}));
vi.mock('../src/services/docs-context-catalog.service', () => ({
	getDocsContextCatalog: mocks.getDocsContextCatalog,
}));
vi.mock('../src/services/sso-group-mapping.service', () => ({
	isGroupRoleMappingActive: vi.fn(async () => false),
}));

import { router } from '../src/trpc/trpc';
import { userGroupRoutes } from '../src/trpc/user-group.routes';

const testRouter = router(userGroupRoutes);

describe('user group routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.role = 'admin';
		mocks.hasFeature.mockResolvedValue(true);
		mocks.getUserGroupOverview.mockResolvedValue({ users: [], groups: [], memberships: [] });
		mocks.getDatabaseContextCatalog.mockReturnValue({ syncState: 'ready', objects: [] });
		mocks.getDocsContextCatalog.mockReturnValue({ syncState: 'ready', entries: [] });
		mocks.resolveEffectiveUserGroupAccess.mockResolvedValue({
			features: ['story-creation'],
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
		mocks.createUserGroup.mockResolvedValue({ id: 'group-id', name: 'Analysts' });
	});

	it('rejects unlicensed requests without querying user groups', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await expect(createCaller().overview()).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'User Groups requires the Enterprise user-groups feature.',
		});
		expect(mocks.getUserGroupOverview).not.toHaveBeenCalled();
	});

	it('requires a project admin', async () => {
		mocks.role = 'user';

		await expect(createCaller().overview()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('validates feature keys and creates a licensed group', async () => {
		await expect(
			createCaller().create({ name: 'Analysts', featureGrants: ['unknown'] as never }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });

		await createCaller().create({
			name: ' Analysts ',
			featureGrants: ['story-creation', 'story-creation'],
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});

		expect(mocks.hasFeature).toHaveBeenCalledWith('user-groups');
		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Analysts',
			['story-creation'],
			{
				defaultDensity: 'compact',
				canChange: false,
			},
			{ mode: 'restricted', strict: true, grants: [], patterns: [] },
			{ mode: 'restricted', grants: [] },
		);
	});

	it('normalizes database access on create', async () => {
		mocks.getDatabaseContextCatalog.mockReturnValue({
			syncState: 'ready',
			objects: [{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'orders' }],
		});
		await createCaller().create({
			name: 'Analysts',
			databaseAccess: {
				mode: 'restricted',
				strict: false,
				grants: [
					{ kind: 'schema', databaseType: 'POSTGRES', database: 'app', schema: 'public' },
					{ kind: 'schema', databaseType: 'postgres', database: 'app', schema: 'public' },
				],
			},
		});

		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Analysts',
			[],
			{ defaultDensity: 'detailed', canChange: true },
			{
				mode: 'restricted',
				strict: false,
				grants: [{ kind: 'schema', databaseType: 'postgres', database: 'app', schema: 'public' }],
				patterns: [],
			},
			{ mode: 'restricted', grants: [] },
		);
	});

	it('normalizes and persists patterns even when they have no current matches', async () => {
		await createCaller().create({
			name: 'Analysts',
			databaseAccess: {
				mode: 'restricted',
				strict: false,
				grants: [],
				patterns: [' Future.* ', 'future.*', 'sales.customer_*'],
			},
		});

		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Analysts',
			[],
			{ defaultDensity: 'detailed', canChange: true },
			{ mode: 'restricted', strict: false, grants: [], patterns: ['future.*', 'sales.customer_*'] },
			{ mode: 'restricted', grants: [] },
		);
	});

	it('bounds pattern count and length', async () => {
		await expect(
			createCaller().create({
				name: 'Analysts',
				databaseAccess: { mode: 'restricted', grants: [], patterns: Array.from({ length: 201 }, () => 'x') },
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			createCaller().create({
				name: 'Analysts',
				databaseAccess: { mode: 'restricted', grants: [], patterns: ['x'.repeat(256)] },
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('rejects malformed docs grants and bounds their size', async () => {
		await expect(
			createCaller().create({
				name: 'Analysts',
				docsAccess: { mode: 'restricted', grants: [{ kind: 'file', path: '../secret.md' }] },
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			createCaller().create({
				name: 'Analysts',
				docsAccess: {
					mode: 'restricted',
					grants: Array.from({ length: 10_001 }, (_, index) => ({
						kind: 'file' as const,
						path: `${index}.md`,
					})),
				},
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('accepts unavailable database and docs grants so they remain removable', async () => {
		await createCaller().create({
			name: 'Analysts',
			databaseAccess: {
				mode: 'restricted',
				grants: [
					{
						kind: 'table',
						databaseType: 'postgres',
						database: 'app',
						schema: 'public',
						table: 'missing',
					},
				],
				patterns: [],
			},
			docsAccess: { mode: 'restricted', grants: [{ kind: 'file', path: 'deleted.md' }] },
		});
		expect(mocks.createUserGroup).toHaveBeenCalledWith(
			'project-id',
			'Analysts',
			[],
			{ defaultDensity: 'detailed', canChange: true },
			{
				mode: 'restricted',
				strict: true,
				grants: [
					{
						kind: 'table',
						databaseType: 'postgres',
						database: 'app',
						schema: 'public',
						table: 'missing',
					},
				],
				patterns: [],
			},
			{ mode: 'restricted', grants: [{ kind: 'file', path: 'deleted.md' }] },
		);
	});

	it('rejects invalid density policies', async () => {
		await expect(
			createCaller().create({
				name: 'Analysts',
				featureGrants: [],
				toolCallDensityPolicy: {
					defaultDensity: 'condensed',
					canChange: true,
				},
			} as never),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(
			createCaller().create({
				name: 'Analysts',
				featureGrants: [],
				toolCallDensityPolicy: {
					defaultDensity: 'compact',
					canChange: 'yes',
				},
			} as never),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.createUserGroup).not.toHaveBeenCalled();
	});

	it('updates feature grants and density policy together', async () => {
		await createCaller().update({
			groupId: 'group-id',
			name: 'Analysts',
			featureGrants: ['automation-creation'],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});

		expect(mocks.updateUserGroup).toHaveBeenCalledWith('project-id', 'group-id', {
			name: 'Analysts',
			featureGrants: ['automation-creation'],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
	});

	it('preserves database access when update omits it', async () => {
		await createCaller().update({
			groupId: 'group-id',
			featureGrants: [],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});

		expect(mocks.updateUserGroup).toHaveBeenCalledWith('project-id', 'group-id', {
			name: undefined,
			featureGrants: [],
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
		});
	});

	it('returns a fresh admin context catalog', async () => {
		mocks.getDatabaseContextCatalog.mockReturnValue({
			syncState: 'ready',
			objects: [{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' }],
		});

		await expect(createCaller().contextCatalog()).resolves.toEqual({
			syncState: 'ready',
			objects: [{ databaseType: 'postgres', database: 'app', schema: 'public', table: 'users' }],
		});
		expect(mocks.getDatabaseContextCatalog).toHaveBeenCalledWith('/project');
	});

	it('returns an independent admin docs catalog', async () => {
		mocks.getDocsContextCatalog.mockReturnValue({
			syncState: 'ready',
			entries: [{ kind: 'file', path: 'finance/kpis.md' }],
		});

		await expect(createCaller().docsContextCatalog()).resolves.toEqual({
			syncState: 'ready',
			entries: [{ kind: 'file', path: 'finance/kpis.md' }],
		});
		expect(mocks.getDocsContextCatalog).toHaveBeenCalledWith('/project');
	});

	it('returns effective access to viewers', async () => {
		mocks.role = 'viewer';

		await expect(createCaller().effectiveAccess()).resolves.toEqual({
			features: {
				'story-creation': true,
				'automation-creation': false,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [] },
		});
		expect(mocks.resolveEffectiveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
	});

	it('returns all effective features without a user-groups license', async () => {
		mocks.role = 'viewer';
		mocks.hasFeature.mockResolvedValue(false);

		await expect(createCaller().effectiveAccess()).resolves.toEqual({
			features: {
				'story-creation': true,
				'automation-creation': true,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'detailed',
				canChange: true,
			},
			databaseAccess: { mode: 'all', strict: true },
			docsAccess: { mode: 'all' },
		});
		expect(mocks.resolveEffectiveUserGroupAccess).not.toHaveBeenCalled();
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
