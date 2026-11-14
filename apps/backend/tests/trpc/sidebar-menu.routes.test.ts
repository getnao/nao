import type { SidebarMenu } from '@nao/shared/sidebar-menu';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	isLicensed: true,
	storedMenu: null as SidebarMenu | null,
	updateMenuSettings: vi.fn(),
	openableStoryIds: [] as string[],
}));

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', orgId: 'org-id', name: 'Project', path: null })),
	getUserRoleInProject: vi.fn(async () => 'admin'),
	getMenuSettings: vi.fn(async () => mocks.storedMenu),
	updateMenuSettings: mocks.updateMenuSettings,
}));
vi.mock('../../src/queries/story-reference.queries', () => ({
	listReferenceableStoryIds: vi.fn(async (_userId: string, _projectId: string, storyIds: string[]) =>
		storyIds.filter((storyId) => mocks.openableStoryIds.includes(storyId)),
	),
}));
vi.mock('../../src/services/license.service', () => ({
	hasFeature: vi.fn(async () => mocks.isLicensed),
}));

import { sidebarMenuRoutes } from '../../src/trpc/sidebar-menu.routes';
import { router } from '../../src/trpc/trpc';

const caller = createTestCaller(router(sidebarMenuRoutes));

const appsMenu: SidebarMenu = {
	entries: [
		{
			type: 'stories-page',
			id: 'apps',
			label: 'Apps',
			icon: 'layout-grid',
			filters: { folderId: null, format: 'custom', certifiedOnly: false, liveOnly: false, owner: 'anyone' },
		},
	],
};

describe('sidebar menu routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isLicensed = true;
		mocks.storedMenu = null;
		mocks.openableStoryIds = [];
	});

	it('serves the stored menu to a licensed project', async () => {
		mocks.storedMenu = appsMenu;

		const menu = await caller.get();

		expect(menu.isCustomizable).toBe(true);
		expect(menu.entries[0]).toMatchObject({ id: 'apps', label: 'Apps' });
	});

	it('flags the story entries the viewer cannot open', async () => {
		mocks.storedMenu = {
			entries: [
				{ type: 'story', id: 'shared-kpis', label: 'KPIs', icon: null, storyId: 'story-shared' },
				{ type: 'story', id: 'private-draft', label: 'Draft', icon: null, storyId: 'story-private' },
			],
		};
		mocks.openableStoryIds = ['story-shared'];

		const menu = await caller.get();

		expect(menu.unavailableEntryIds).toEqual(['private-draft']);
		expect(menu.entries.map((entry) => entry.id)).toContain('private-draft');
	});

	it('falls back to the default menu once the license lapses', async () => {
		mocks.isLicensed = false;
		mocks.storedMenu = appsMenu;

		const menu = await caller.get();

		expect(menu.isCustomizable).toBe(false);
		expect(menu.entries.some((entry) => entry.id === 'apps')).toBe(false);
	});

	it('saves the menu for a licensed project', async () => {
		await expect(caller.update(appsMenu)).resolves.toEqual({ ok: true });
		expect(mocks.updateMenuSettings).toHaveBeenCalledWith('project-id', appsMenu);
	});

	it.each([
		['update', () => caller.update(appsMenu)],
		['reset', () => caller.reset()],
	])('refuses to %s the menu without the white-label feature', async (_, call) => {
		mocks.isLicensed = false;

		await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.updateMenuSettings).not.toHaveBeenCalled();
	});
});
