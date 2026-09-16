/* @license Enterprise */

import type { OidcGroupNaoGroupMapping } from '../utils/sso-group-mapping';
import { resolveOidcGroupNaoGroupMappings } from '../utils/sso-group-mapping';
import { listActiveUserGroups } from './user-group-availability.service';

export interface EffectiveOidcUserGroupMapping {
	identifier: string;
	targetGroupId: string | null;
	targetGroupName: string;
}

export async function listEffectiveOidcUserGroupMappings(
	projectId: string,
	mappings: OidcGroupNaoGroupMapping[],
): Promise<EffectiveOidcUserGroupMapping[]> {
	const groups = (await listActiveUserGroups(projectId)).filter((group) => !group.isDefault);
	const selectedMappings = resolveOidcGroupNaoGroupMappings(
		mappings.map((mapping) => mapping.oidcGroup),
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
