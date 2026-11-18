/* @license Enterprise */

import {
	type EntraGroupNaoGroupMapping,
	type OidcGroupNaoGroupMapping,
	resolveEntraGroupNaoGroupMappings,
	resolveOidcGroupNaoGroupMappings,
} from '../utils/sso-group-mapping';
import { listActiveUserGroups } from './user-group-availability.service';

export interface EffectiveUserGroupMapping {
	identifier: string;
	targetGroupId: string | null;
	targetGroupName: string;
}

export type EffectiveOidcUserGroupMapping = EffectiveUserGroupMapping;
export type EffectiveEntraUserGroupMapping = EffectiveUserGroupMapping;

export async function listEffectiveOidcUserGroupMappings(
	projectId: string,
	mappings: OidcGroupNaoGroupMapping[],
): Promise<EffectiveOidcUserGroupMapping[]> {
	return listEffectiveUserGroupMappings(
		projectId,
		resolveOidcGroupNaoGroupMappings(
			mappings.map((mapping) => mapping.oidcGroup),
			projectId,
			mappings,
		),
	);
}

export async function listEffectiveEntraUserGroupMappings(
	projectId: string,
	mappings: EntraGroupNaoGroupMapping[],
): Promise<EffectiveEntraUserGroupMapping[]> {
	return listEffectiveUserGroupMappings(
		projectId,
		resolveEntraGroupNaoGroupMappings(
			mappings.map((mapping) => mapping.entraGroupId),
			projectId,
			mappings,
		),
	);
}

async function listEffectiveUserGroupMappings(
	projectId: string,
	selectedMappings: Map<string, string>,
): Promise<EffectiveUserGroupMapping[]> {
	const groups = (await listActiveUserGroups(projectId)).filter((group) => !group.isDefault);
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
