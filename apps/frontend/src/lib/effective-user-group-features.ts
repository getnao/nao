import type { ToolCallDensityPolicy, UserGroupFeature } from '@nao/shared';
import type { ToolCallDensity } from '@nao/shared/types';

export type EffectiveUserGroupFeatures = Record<UserGroupFeature, boolean>;

export interface EffectiveUserGroupAccess {
	features: EffectiveUserGroupFeatures;
	toolCallDensityPolicy: ToolCallDensityPolicy;
}

const DENIED_FEATURES: EffectiveUserGroupFeatures = {
	'story-creation': false,
	'automation-creation': false,
};

const LOADING_ACCESS: EffectiveUserGroupAccess = {
	features: DENIED_FEATURES,
	toolCallDensityPolicy: {
		defaultDensity: 'detailed',
		canChange: false,
	},
};

export function getRenderableUserGroupAccess(
	access: EffectiveUserGroupAccess | undefined,
	isAvailable: boolean,
): EffectiveUserGroupAccess {
	return isAvailable && access ? access : LOADING_ACCESS;
}

export function getEffectiveToolCallDensity(
	storedDensity: ToolCallDensity | undefined,
	policy: ToolCallDensityPolicy,
): ToolCallDensity {
	if (!policy.canChange) {
		return policy.defaultDensity;
	}
	return storedDensity ?? policy.defaultDensity;
}
