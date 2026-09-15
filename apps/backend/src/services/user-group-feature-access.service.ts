import {
	type DatabaseContextAccess,
	type DocsContextAccess,
	type ToolCallDensityPolicy,
	USER_GROUP_FEATURES,
	type UserGroupFeature,
	type UserGroupRowPolicies,
} from '@nao/shared';

import { HandlerError } from '../utils/error';
import { resolveAvailableUserGroupAccess } from './user-group-availability.service';

export type UserGroupFeatureFlags = Record<UserGroupFeature, boolean>;

export interface EffectiveUserGroupAccess {
	features: UserGroupFeatureFlags;
	toolCallDensityPolicy: ToolCallDensityPolicy;
	databaseAccess: DatabaseContextAccess;
	docsAccess: DocsContextAccess;
}

export interface EffectiveUserGroupAccessForUserDetail extends EffectiveUserGroupAccess {
	rowPolicies: UserGroupRowPolicies[];
}

export class UserGroupFeatureAccessError extends HandlerError {
	constructor(feature: UserGroupFeature) {
		super('FORBIDDEN', `${featureLabel(feature)} is not enabled for your user group.`);
		this.name = 'UserGroupFeatureAccessError';
	}
}

export async function getEffectiveUserGroupAccess(
	projectId: string,
	userId: string,
): Promise<EffectiveUserGroupAccess> {
	const access = await resolveAvailableUserGroupAccess(projectId, userId);
	return formatEffectiveUserGroupAccess(access);
}

export async function getEffectiveUserGroupAccessForUserDetail(
	projectId: string,
	userId: string,
): Promise<EffectiveUserGroupAccessForUserDetail> {
	const access = await resolveAvailableUserGroupAccess(projectId, userId);
	return {
		...formatEffectiveUserGroupAccess(access),
		rowPolicies: access.rowPolicies,
	};
}

export async function getEffectiveUserGroupFeatureFlags(
	projectId: string,
	userId: string,
): Promise<UserGroupFeatureFlags> {
	return (await getEffectiveUserGroupAccess(projectId, userId)).features;
}

export async function hasUserGroupFeature(
	projectId: string,
	userId: string,
	feature: UserGroupFeature,
): Promise<boolean> {
	return (await getEffectiveUserGroupFeatureFlags(projectId, userId))[feature];
}

export async function assertUserGroupFeature(
	projectId: string,
	userId: string,
	feature: UserGroupFeature,
): Promise<void> {
	if (!(await hasUserGroupFeature(projectId, userId, feature))) {
		throw new UserGroupFeatureAccessError(feature);
	}
}

function featureLabel(feature: UserGroupFeature): string {
	switch (feature) {
		case 'story-creation':
			return 'Story creation';
		case 'automation-creation':
			return 'Automation creation';
	}
}

export function createUserGroupFeatureFlags(features: readonly UserGroupFeature[]): UserGroupFeatureFlags {
	const effectiveFeatures = new Set(features);
	return Object.fromEntries(
		USER_GROUP_FEATURES.map((feature) => [feature, effectiveFeatures.has(feature)]),
	) as UserGroupFeatureFlags;
}

function formatEffectiveUserGroupAccess(
	access: Awaited<ReturnType<typeof resolveAvailableUserGroupAccess>>,
): EffectiveUserGroupAccess {
	return {
		features: createUserGroupFeatureFlags(access.features),
		toolCallDensityPolicy: access.toolCallDensityPolicy,
		databaseAccess: access.databaseAccess,
		docsAccess: access.docsAccess,
	};
}
