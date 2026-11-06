import { SYSTEM_EXAMPLE_PROJECT_ID } from '@nao/shared';

import { isCloud } from '../env';

/** Projects every signed-in user can view without a membership, so they stay invisible to each other. */
export function getOpenProjectIds(): string[] {
	return isCloud ? [SYSTEM_EXAMPLE_PROJECT_ID] : [];
}

export function isOpenProject(projectId: string): boolean {
	return getOpenProjectIds().includes(projectId);
}
