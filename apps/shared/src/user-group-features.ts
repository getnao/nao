import type { ToolCallDensity } from './types';

export const USER_GROUP_FEATURES = ['storyCreation', 'customStoryCreation', 'automationCreation'] as const;

export type UserGroupFeature = (typeof USER_GROUP_FEATURES)[number];

export interface ToolCallDensityPolicy {
	defaultDensity: ToolCallDensity;
	canChange: boolean;
}

export interface UserGroupConfig {
	features: UserGroupFeature[];
	toolCallDensity: ToolCallDensityPolicy;
}

export type StoredUserGroupConfig =
	| readonly string[]
	| {
			version: 2;
			features: UserGroupFeature[];
			toolCallDensity: ToolCallDensityPolicy;
	  };

export const DEFAULT_TOOL_CALL_DENSITY_POLICY: ToolCallDensityPolicy = {
	defaultDensity: 'detailed',
	canChange: true,
};

export const DEFAULT_USER_GROUP_NAME = 'All Users';
export const FREE_CUSTOM_USER_GROUP_LIMIT = 3;

export const DEFAULT_USER_GROUP_CONFIG: StoredUserGroupConfig = {
	version: 2,
	features: [],
	toolCallDensity: DEFAULT_TOOL_CALL_DENSITY_POLICY,
};

export interface UserGroupFeatureDefinition {
	key: UserGroupFeature;
	label: string;
	description: string;
	requires?: UserGroupFeature;
}

export const USER_GROUP_FEATURE_DEFINITIONS: ReadonlyArray<UserGroupFeatureDefinition> = [
	{
		key: 'storyCreation',
		label: 'Stories',
		description: 'Allow the user to create new stories',
	},
	{
		key: 'customStoryCreation',
		label: 'Custom stories',
		description: 'Allow the user to create custom stories that work as data apps',
		requires: 'storyCreation',
	},
	{
		key: 'automationCreation',
		label: 'Automations',
		description: 'Allow the user to create new automations',
	},
];

/** Drops the features whose prerequisite is not granted: custom stories without stories grant nothing. */
export function withSatisfiedFeatureDependencies<Feature extends UserGroupFeature>(
	features: readonly Feature[],
): Feature[] {
	const granted = new Set<UserGroupFeature>(features);
	return features.filter((feature) => {
		const requires = USER_GROUP_FEATURE_DEFINITIONS.find((definition) => definition.key === feature)?.requires;
		return requires === undefined || granted.has(requires);
	});
}

export function normalizeUserGroupFeatures(features: readonly string[]): UserGroupFeature[] {
	return [
		...new Set(
			features
				.map((feature) => {
					if (feature === 'stories' || feature === 'story-creation') {
						return 'storyCreation';
					}
					if (feature === 'automations' || feature === 'automation-creation') {
						return 'automationCreation';
					}
					return feature;
				})
				.filter((feature): feature is UserGroupFeature =>
					USER_GROUP_FEATURES.includes(feature as UserGroupFeature),
				),
		),
	];
}

export function parseStoredUserGroupConfig(value: unknown): UserGroupConfig {
	if (Array.isArray(value)) {
		const legacyFeatures = value.filter((feature): feature is string => typeof feature === 'string');
		return {
			features: normalizeUserGroupFeatures(legacyFeatures),
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: legacyFeatures.includes('compact-mode'),
			},
		};
	}

	if (!isRecord(value) || value.version !== 2) {
		return {
			features: [],
			toolCallDensity: { defaultDensity: 'detailed', canChange: false },
		};
	}

	const features = Array.isArray(value.features)
		? value.features.filter((feature): feature is string => typeof feature === 'string')
		: [];
	const policy = isRecord(value.toolCallDensity) ? value.toolCallDensity : {};

	return {
		features: normalizeUserGroupFeatures(features),
		toolCallDensity: {
			defaultDensity: policy.defaultDensity === 'compact' ? 'compact' : 'detailed',
			canChange: policy.canChange === true,
		},
	};
}

export function serializeUserGroupConfig(
	features: readonly string[],
	toolCallDensity: ToolCallDensityPolicy,
): StoredUserGroupConfig {
	return {
		version: 2,
		features: normalizeUserGroupFeatures(features),
		toolCallDensity: {
			defaultDensity: toolCallDensity.defaultDensity,
			canChange: toolCallDensity.canChange,
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
