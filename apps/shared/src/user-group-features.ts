import { MAX_PRELOADED_SKILLS, type ToolCallDensity, type UserRole } from './types';

export const USER_GROUP_FEATURES = ['storyCreation', 'customStoryCreation', 'automationCreation'] as const;

export type UserGroupFeature = (typeof USER_GROUP_FEATURES)[number];

export const PROJECT_SHARING_PERMISSIONS = ['inherit', 'allowed', 'blocked'] as const;

export type ProjectSharingPermission = (typeof PROJECT_SHARING_PERMISSIONS)[number];

export interface ToolCallDensityPolicy {
	defaultDensity: ToolCallDensity;
	canChange: boolean;
}

export interface UserGroupConfig {
	features: UserGroupFeature[];
	toolCallDensity: ToolCallDensityPolicy;
	showAllSettings: boolean;
	projectSharing: ProjectSharingPermission;
	preloadedSkills: string[];
}

export type StoredUserGroupConfig =
	| readonly string[]
	| {
			version: 2;
			features: UserGroupFeature[];
			toolCallDensity: ToolCallDensityPolicy;
			showAllSettings?: boolean;
			projectSharing?: ProjectSharingPermission;
			preloadedSkills?: string[];
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

/**
 * Advanced settings are every settings page beyond the user's own account. Only the User role depends
 * on its groups: admins and context admins always see them, viewers never do.
 */
export function canRoleSeeAdvancedSettings(role: UserRole | null | undefined, groupsShowAllSettings: boolean): boolean {
	switch (role) {
		case 'admin':
		case 'context_admin':
			return true;
		case 'user':
			return groupsShowAllSettings;
		default:
			return false;
	}
}

/** An explicit block on any of the user's groups wins over an explicit allow, which wins over the All Users default. */
export function resolveProjectSharingPermission(
	groups: ReadonlyArray<{ isDefault: boolean; projectSharing: ProjectSharingPermission }>,
): boolean {
	const overrides = groups.filter((group) => !group.isDefault).map((group) => group.projectSharing);
	if (overrides.includes('blocked')) {
		return false;
	}
	if (overrides.includes('allowed')) {
		return true;
	}
	return !groups.some((group) => group.isDefault && group.projectSharing === 'blocked');
}

/**
 * All Users' skills come first, then each other group's in name order, without duplicates.
 * The limit applies to the merged list, so the group editor counts All Users' skills against it;
 * a member of several custom groups can still have the last groups' picks skipped once the limit is reached.
 */
export function resolvePreloadedSkills(
	groups: ReadonlyArray<{ isDefault: boolean; name: string; preloadedSkills: readonly string[] }>,
): string[] {
	const orderedGroups = [...groups].sort(
		(left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name),
	);
	return normalizePreloadedSkills(orderedGroups.flatMap((group) => group.preloadedSkills));
}

export function normalizePreloadedSkills(skillNames: readonly unknown[]): string[] {
	const names = skillNames
		.filter((name): name is string => typeof name === 'string')
		.map((name) => name.trim())
		.filter((name) => name.length > 0);
	return [...new Set(names)].slice(0, MAX_PRELOADED_SKILLS);
}

/** Groups saved before the setting existed keep the previous behavior: All Users shows every settings page. */
export function parseStoredUserGroupConfig(value: unknown, isDefault = false): UserGroupConfig {
	if (Array.isArray(value)) {
		const legacyFeatures = value.filter((feature): feature is string => typeof feature === 'string');
		return {
			features: normalizeUserGroupFeatures(legacyFeatures),
			toolCallDensity: {
				defaultDensity: 'detailed',
				canChange: legacyFeatures.includes('compact-mode'),
			},
			projectSharing: 'inherit',
			showAllSettings: isDefault,
			preloadedSkills: [],
		};
	}

	if (!isRecord(value) || value.version !== 2) {
		return {
			features: [],
			toolCallDensity: { defaultDensity: 'detailed', canChange: false },
			projectSharing: 'inherit',
			showAllSettings: isDefault,
			preloadedSkills: [],
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
		projectSharing: parseProjectSharingPermission(value.projectSharing),
		showAllSettings: typeof value.showAllSettings === 'boolean' ? value.showAllSettings : isDefault,
		preloadedSkills: Array.isArray(value.preloadedSkills) ? normalizePreloadedSkills(value.preloadedSkills) : [],
	};
}

export function serializeUserGroupConfig(
	features: readonly string[],
	toolCallDensity: ToolCallDensityPolicy,
	projectSharing: ProjectSharingPermission = 'inherit',
	showAllSettings = false,
	preloadedSkills: readonly string[] = [],
): StoredUserGroupConfig {
	return {
		version: 2,
		features: normalizeUserGroupFeatures(features),
		toolCallDensity: {
			defaultDensity: toolCallDensity.defaultDensity,
			canChange: toolCallDensity.canChange,
		},
		projectSharing: parseProjectSharingPermission(projectSharing),
		showAllSettings,
		preloadedSkills: normalizePreloadedSkills(preloadedSkills),
	};
}

function parseProjectSharingPermission(value: unknown): ProjectSharingPermission {
	return PROJECT_SHARING_PERMISSIONS.includes(value as ProjectSharingPermission)
		? (value as ProjectSharingPermission)
		: 'inherit';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
