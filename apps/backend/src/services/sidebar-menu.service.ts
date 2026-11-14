/* @license Enterprise */

import { resolveSidebarMenu, type SidebarMenu, type SidebarMenuEntry } from '@nao/shared/sidebar-menu';

import * as projectQueries from '../queries/project.queries';
import * as storyReferenceQueries from '../queries/story-reference.queries';
import { LICENSE_FEATURES } from '../types/license';
import { hasFeature } from './license.service';

export interface ProjectSidebarMenu {
	isCustomizable: boolean;
	entries: SidebarMenuEntry[];
	/** Story entries the viewer cannot open, which the sidebar hides but the menu editor keeps. */
	unavailableEntryIds: string[];
}

/**
 * A stored menu is ignored once the white-label feature lapses, so an
 * unlicensed project falls back to the default entries.
 */
export async function getProjectSidebarMenu(projectId: string, userId: string): Promise<ProjectSidebarMenu> {
	const isCustomizable = await isSidebarMenuCustomizable(projectId);
	const storedMenu = isCustomizable ? await projectQueries.getMenuSettings(projectId) : null;
	const entries = resolveSidebarMenu(storedMenu);
	const unavailableEntryIds = await listUnavailableStoryEntryIds(entries, projectId, userId);
	return { isCustomizable, entries, unavailableEntryIds };
}

export async function saveProjectSidebarMenu(projectId: string, menu: SidebarMenu | null): Promise<void> {
	await projectQueries.updateMenuSettings(projectId, menu);
}

export function isSidebarMenuCustomizable(projectId: string): Promise<boolean> {
	return hasFeature(LICENSE_FEATURES.whiteLabel, { projectId });
}

async function listUnavailableStoryEntryIds(
	entries: SidebarMenuEntry[],
	projectId: string,
	userId: string,
): Promise<string[]> {
	const storyEntries = entries.filter((entry) => entry.type === 'story');
	const openableStoryIds = new Set(
		await storyReferenceQueries.listReferenceableStoryIds(
			userId,
			projectId,
			storyEntries.map((entry) => entry.storyId),
		),
	);
	return storyEntries.filter((entry) => !openableStoryIds.has(entry.storyId)).map((entry) => entry.id);
}
