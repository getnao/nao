/* @license Enterprise */

import type { EntraGroupNaoGroupMapping } from '../utils/sso-group-mapping';
import { resolveEntraGroupNaoGroupMappings } from '../utils/sso-group-mapping';
import { listActiveUserGroups } from './user-group-availability.service';

export interface EffectiveEntraUserGroupMapping {
	identifier: string;
	targetGroupId: string | null;
	targetGroupName: string;
}

export async function listEffectiveEntraUserGroupMappings(
	projectId: string,
	mappings: EntraGroupNaoGroupMapping[],
): Promise<EffectiveEntraUserGroupMapping[]> {
	const groups = (await listActiveUserGroups(projectId)).filter((group) => !group.isDefault);
	const selectedMappings = resolveEntraGroupNaoGroupMappings(
		mappings.map((mapping) => mapping.entraGroupId),
		projectId,
		mappings,
	);
	const groupsByName = new Map(groups.map((group) => [group.name.trim().toLowerCase(), group]));

	return [...selectedMappings].map(([identifier, targetName]) => {
		const targetGroup = groupsByName.get(targetName.trim().toLowerCase());
		return {
			identifier,
			targetGroupId: targetGroup?.id ?? null,
			targetGroupName: targetGroup?.name ?? targetName,
		};
	});
}
