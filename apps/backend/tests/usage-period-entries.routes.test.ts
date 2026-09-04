import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	preferences: {} as Record<string, unknown>,
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));

vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({
		id: 'project-id',
		name: 'Test project',
		path: '/tmp/nao-project',
		envVars: {},
	})),
	getUserRoleInProject: vi.fn(async () => 'admin'),
}));

vi.mock('../src/queries/usage.queries', () => ({
	getMessagesUsage: vi.fn(),
	getTotalUsage: vi.fn(),
	getUsedProviders: vi.fn(),
}));

vi.mock('../src/queries/user-project-preference.queries', () => ({
	getUserProjectPreferences: vi.fn(async () => state.preferences),
	updateUserProjectPreferences: vi.fn(async (_userId, _projectId, partial: Record<string, unknown>) => {
		state.preferences = { ...state.preferences, ...partial };
		return state.preferences;
	}),
	mutateUserProjectPreferences: vi.fn(
		async (_userId, _projectId, transform: (current: Record<string, unknown>) => Record<string, unknown>) => {
			state.preferences = transform(state.preferences);
			return state.preferences;
		},
	),
}));

vi.mock('../src/services/sso-group-mapping.service', () => ({
	isGroupRoleMappingActive: vi.fn(async () => false),
}));

import { router } from '../src/trpc/trpc';
import { usageRoutes } from '../src/trpc/usage.routes';
import {
	DEFAULT_USAGE_PERIOD_PREFERENCE,
	MAX_USAGE_PERIOD_ENTRIES,
	USAGE_PERIOD_ENTRY_LIMIT_MESSAGE,
} from '../src/types/usage';

const testRouter = router(usageRoutes);

describe('usage period entry routes', () => {
	beforeEach(() => {
		state.preferences = {};
	});

	it('creates, updates, selects, and deletes entries', async () => {
		const caller = createCaller();
		const created = await caller.createPeriodEntry({
			projectId: 'project-id',
			entry: { days: 5000, granularity: 'month' },
		});

		expect(created.id).toEqual(expect.any(String));
		await expect(caller.getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			preference: { mode: 'saved', entryId: created.id },
			entries: [created],
		});

		const updated = await caller.updatePeriodEntry({
			projectId: 'project-id',
			entry: { ...created, days: 730, granularity: 'day' },
		});
		await expect(caller.getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			preference: { mode: 'saved', entryId: created.id },
			entries: [updated],
		});

		await caller.updatePeriodPreference({
			projectId: 'project-id',
			preference: { mode: 'saved', entryId: created.id },
		});
		await expect(caller.getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			preference: { mode: 'saved', entryId: created.id },
			entries: [updated],
		});

		await expect(caller.deletePeriodEntry({ projectId: 'project-id', id: created.id })).resolves.toEqual({
			id: created.id,
			usagePeriod: DEFAULT_USAGE_PERIOD_PREFERENCE,
		});
		await expect(caller.getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			preference: DEFAULT_USAGE_PERIOD_PREFERENCE,
			entries: [],
		});
	});

	it('rejects creating more than the saved entry limit', async () => {
		const entries = Array.from({ length: MAX_USAGE_PERIOD_ENTRIES }, (_, index) => ({
			id: `entry-${index}`,
			days: index + 1,
			granularity: 'day',
		}));
		state.preferences = { usagePeriodEntries: entries };

		await expect(
			createCaller().createPeriodEntry({
				projectId: 'project-id',
				entry: { days: 30, granularity: 'day' },
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: USAGE_PERIOD_ENTRY_LIMIT_MESSAGE,
		});
		expect(state.preferences).toEqual({ usagePeriodEntries: entries });
	});

	it('repairs stored entries above the saved entry limit', async () => {
		const entries = Array.from({ length: MAX_USAGE_PERIOD_ENTRIES + 1 }, (_, index) => ({
			id: `entry-${index}`,
			days: index + 1,
			granularity: 'day' as const,
		}));
		const retainedEntries = entries.slice(0, MAX_USAGE_PERIOD_ENTRIES);
		state.preferences = {
			usagePeriod: { mode: 'saved', entryId: entries.at(-1)?.id ?? '' },
			usagePeriodEntries: entries,
		};

		await expect(createCaller().getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			preference: DEFAULT_USAGE_PERIOD_PREFERENCE,
			entries: retainedEntries,
		});
		expect(state.preferences).toEqual({
			usagePeriod: DEFAULT_USAGE_PERIOD_PREFERENCE,
			usagePeriodEntries: retainedEntries,
		});
	});

	it('rejects unknown entries', async () => {
		const caller = createCaller();

		await expect(
			caller.updatePeriodPreference({
				projectId: 'project-id',
				preference: { mode: 'saved', entryId: 'missing' },
			}),
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
		await expect(caller.deletePeriodEntry({ projectId: 'project-id', id: 'missing' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	it('preserves valid entries when stored data contains a malformed item', async () => {
		state.preferences = {
			usagePeriodEntries: [
				{ id: 'valid', days: 30, granularity: 'day' },
				{ id: 'invalid', days: 0, granularity: 'day' },
			],
		};
		const caller = createCaller();

		const created = await caller.createPeriodEntry({
			projectId: 'project-id',
			entry: { days: 365, granularity: 'month' },
		});

		await expect(caller.getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			preference: { mode: 'saved', entryId: created.id },
			entries: [{ id: 'valid', days: 30, granularity: 'day' }, created],
		});
	});

	it('repairs an orphaned saved preference', async () => {
		state.preferences = {
			usagePeriod: { mode: 'saved', entryId: 'invalid' },
			usagePeriodEntries: [{ id: 'invalid', days: 0, granularity: 'day' }],
		};

		await expect(createCaller().getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			preference: DEFAULT_USAGE_PERIOD_PREFERENCE,
			entries: [],
		});
		expect(state.preferences).toEqual({
			usagePeriod: DEFAULT_USAGE_PERIOD_PREFERENCE,
			usagePeriodEntries: [],
		});
	});

	it('removes legacy custom preferences and malformed entries from storage', async () => {
		const validEntry = { id: 'valid', days: 365, granularity: 'month' };
		state.preferences = {
			usagePeriod: { mode: 'custom', customPeriod: { value: 30, unit: 'day' } },
			usagePeriodEntries: [validEntry, { id: 'invalid', days: 0, granularity: 'day' }],
		};

		await expect(createCaller().getPeriodSettings({ projectId: 'project-id' })).resolves.toEqual({
			preference: DEFAULT_USAGE_PERIOD_PREFERENCE,
			entries: [validEntry],
		});
		expect(state.preferences).toEqual({
			usagePeriod: DEFAULT_USAGE_PERIOD_PREFERENCE,
			usagePeriodEntries: [validEntry],
		});
	});

	it('rejects preference requests for a stale project', async () => {
		await expect(createCaller().getPeriodSettings({ projectId: 'other-project' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
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
