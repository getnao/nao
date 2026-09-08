import {
	ALL_DATABASE_CONTEXT_ACCESS,
	type DatabaseContextAccess,
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	type ToolCallDensityPolicy,
	USER_GROUP_FEATURES,
	type UserGroupFeature,
} from '@nao/shared';

import { resolveEffectiveUserGroupAccess } from '../queries/user-group.queries';
import { HandlerError } from '../utils/error';
import { hasFeature, LICENSE_FEATURES } from './license.service';

export type UserGroupFeatureFlags = Record<UserGroupFeature, boolean>;

export interface EffectiveUserGroupAccess {
	features: UserGroupFeatureFlags;
	toolCallDensityPolicy: ToolCallDensityPolicy;
	databaseAccess: DatabaseContextAccess;
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
	if (!(await hasFeature(LICENSE_FEATURES.userGroups))) {
		return {
			features: createFeatureFlags(USER_GROUP_FEATURES),
			toolCallDensityPolicy: DEFAULT_TOOL_CALL_DENSITY_POLICY,
			databaseAccess: ALL_DATABASE_CONTEXT_ACCESS,
		};
	}
	const access = await resolveEffectiveUserGroupAccess(projectId, userId);
	return {
		features: createFeatureFlags(access.features),
		toolCallDensityPolicy: access.toolCallDensityPolicy,
		databaseAccess: access.databaseAccess,
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

function createFeatureFlags(features: readonly UserGroupFeature[]): UserGroupFeatureFlags {
	const effectiveFeatures = new Set(features);
	return Object.fromEntries(
		USER_GROUP_FEATURES.map((feature) => [feature, effectiveFeatures.has(feature)]),
	) as UserGroupFeatureFlags;
}
