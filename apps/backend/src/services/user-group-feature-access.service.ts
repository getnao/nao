import {
	canRoleSeeAdvancedSettings,
	type DatabaseContextAccess,
	type DocsContextAccess,
	type FilesContextAccess,
	type McpAccess,
	type ToolCallDensityPolicy,
	USER_GROUP_FEATURES,
	type UserGroupFeature,
	type UserGroupRowPolicies,
} from '@nao/shared';
import type { UserRole } from '@nao/shared/types';

import { env } from '../env';
import { HandlerError } from '../utils/error';
import { resolveAvailableUserGroupAccess } from './user-group-availability.service';

export type UserGroupFeatureFlags = Record<UserGroupFeature, boolean>;

export interface AgentUserGroupAccess {
	features: UserGroupFeatureFlags;
	restrictedFeatures: UserGroupFeature[];
}

export interface EffectiveUserGroupAccess {
	features: UserGroupFeatureFlags;
	toolCallDensityPolicy: ToolCallDensityPolicy;
	canSeeAdvancedSettings: boolean;
	databaseAccess: DatabaseContextAccess;
	docsAccess: DocsContextAccess;
	filesAccess: FilesContextAccess;
	mcpAccess: McpAccess;
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
	role: UserRole | null,
): Promise<EffectiveUserGroupAccess> {
	const access = await resolveAvailableUserGroupAccess(projectId, userId);
	return formatEffectiveUserGroupAccess(access, role);
}

export async function getEffectiveUserGroupAccessForUserDetail(
	projectId: string,
	userId: string,
	role: UserRole | null,
): Promise<EffectiveUserGroupAccessForUserDetail> {
	const access = await resolveAvailableUserGroupAccess(projectId, userId);
	return {
		...formatEffectiveUserGroupAccess(access, role),
		rowPolicies: access.rowPolicies,
	};
}

export async function getEffectiveUserGroupFeatureFlags(
	projectId: string,
	userId: string,
): Promise<UserGroupFeatureFlags> {
	const access = await resolveAvailableUserGroupAccess(projectId, userId);
	return createUserGroupFeatureFlags(access.features);
}

export async function canSeeAdvancedSettings(
	projectId: string,
	userId: string,
	role: UserRole | null,
): Promise<boolean> {
	const access = await resolveAvailableUserGroupAccess(projectId, userId);
	return canRoleSeeAdvancedSettings(role, access.showAllSettings);
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
		case 'storyCreation':
			return 'Story creation';
		case 'customStoryCreation':
			return 'Custom story creation';
		case 'automationCreation':
			return 'Automation creation';
	}
}

export function createUserGroupFeatureFlags(features: readonly UserGroupFeature[]): UserGroupFeatureFlags {
	const effectiveFeatures = new Set(features);
	return Object.fromEntries(
		USER_GROUP_FEATURES.map((feature) => [feature, effectiveFeatures.has(feature)]),
	) as UserGroupFeatureFlags;
}

export function resolveAgentUserGroupAccess(
	features: readonly UserGroupFeature[],
	agentTools: Readonly<Record<string, unknown>>,
): AgentUserGroupAccess {
	const userGroupFeatureFlags = createUserGroupFeatureFlags(features);
	return {
		features: userGroupFeatureFlags,
		restrictedFeatures: USER_GROUP_FEATURES.filter(
			(feature) => !userGroupFeatureFlags[feature] && isAgentFeaturePolicyRelevant(feature, agentTools),
		),
	};
}

export function appendAgentUserGroupRestrictions(systemPrompt: string, access: AgentUserGroupAccess): string {
	const messages = access.restrictedFeatures.map((feature) => AGENT_FEATURE_POLICIES[feature].restrictionMessage);
	if (messages.length === 0) {
		return systemPrompt;
	}
	return `${systemPrompt}\n\n## User group permissions\n\n${messages.join('\n\n')}`;
}

function formatEffectiveUserGroupAccess(
	access: Awaited<ReturnType<typeof resolveAvailableUserGroupAccess>>,
	role: UserRole | null,
): EffectiveUserGroupAccess {
	return {
		features: createUserGroupFeatureFlags(access.features),
		toolCallDensityPolicy: access.toolCallDensityPolicy,
		canSeeAdvancedSettings: canRoleSeeAdvancedSettings(role, access.showAllSettings),
		databaseAccess: access.databaseAccess,
		docsAccess: access.docsAccess,
		filesAccess: access.filesAccess,
		mcpAccess: access.mcpAccess,
	};
}

interface AgentFeaturePolicy {
	requiredTool?: string;
	isOffered?: () => boolean;
	restrictionMessage: string;
}

const AGENT_FEATURE_POLICIES: Record<UserGroupFeature, AgentFeaturePolicy> = {
	storyCreation: {
		requiredTool: 'story',
		restrictionMessage:
			'Story creation through the agent is unavailable for this user in this project. Do not attempt or offer to create a new Story, and do not suggest Story mode. You may update or replace existing Stories with the Story tool. If asked, explain that their group does not grant Story creation.',
	},
	customStoryCreation: {
		requiredTool: 'story',
		isOffered: () => env.BETA_CUSTOM_STORIES_ENABLED,
		restrictionMessage:
			'Custom story creation is unavailable for this user in this project. Never create a story with format "custom" and do not suggest Custom story mode; build classic stories only. If asked, explain that their group does not grant custom stories.',
	},
	automationCreation: {
		restrictionMessage:
			'Automation creation is unavailable for this user in this project. Do not attempt, offer, or suggest creating an Automation. The user can still view and manage existing Automations in the app. If asked, explain that their group does not grant Automation creation.',
	},
};

function isAgentFeaturePolicyRelevant(
	feature: UserGroupFeature,
	agentTools: Readonly<Record<string, unknown>>,
): boolean {
	const { requiredTool, isOffered } = AGENT_FEATURE_POLICIES[feature];
	return (isOffered?.() ?? true) && (requiredTool === undefined || requiredTool in agentTools);
}
