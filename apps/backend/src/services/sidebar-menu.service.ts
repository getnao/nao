/* @license Enterprise */

import { resolveSidebarMenu, type SidebarMenu, type SidebarMenuEntry } from '@nao/shared/sidebar-menu';

import * as projectQueries from '../queries/project.queries';
import { LICENSE_FEATURES } from '../types/license';
import { hasFeature } from './license.service';

export interface ProjectSidebarMenu {
	isCustomizable: boolean;
	entries: SidebarMenuEntry[];
}

/**
 * A stored menu is ignored once the white-label feature lapses, so an
 * unlicensed project falls back to the default entries.
 */
export async function getProjectSidebarMenu(projectId: string): Promise<ProjectSidebarMenu> {
	const isCustomizable = await isSidebarMenuCustomizable(projectId);
	const storedMenu = isCustomizable ? await projectQueries.getMenuSettings(projectId) : null;
	return { isCustomizable, entries: resolveSidebarMenu(storedMenu) };
}

export async function saveProjectSidebarMenu(projectId: string, menu: SidebarMenu | null): Promise<void> {
	await projectQueries.updateMenuSettings(projectId, menu);
}

export function isSidebarMenuCustomizable(projectId: string): Promise<boolean> {
	return hasFeature(LICENSE_FEATURES.whiteLabel, { projectId });
}
