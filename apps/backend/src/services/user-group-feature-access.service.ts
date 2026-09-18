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

export interface AgentUserGroupAccess {
	features: UserGroupFeatureFlags;
	restrictedFeatures: UserGroupFeature[];
}

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
		case 'storyCreation':
			return 'Story creation';
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
): EffectiveUserGroupAccess {
	return {
		features: createUserGroupFeatureFlags(access.features),
		toolCallDensityPolicy: access.toolCallDensityPolicy,
		databaseAccess: access.databaseAccess,
		docsAccess: access.docsAccess,
	};
}

interface AgentFeaturePolicy {
	requiredTool?: string;
	restrictionMessage: string;
}

const AGENT_FEATURE_POLICIES: Record<UserGroupFeature, AgentFeaturePolicy> = {
	storyCreation: {
		requiredTool: 'story',
		restrictionMessage:
			'Story creation through the agent is unavailable for this user in this project. Do not attempt or offer to create a new Story, and do not suggest Story mode. You may update or replace existing Stories with the Story tool. If asked, explain that their group does not grant Story creation.',
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
	const requiredTool = AGENT_FEATURE_POLICIES[feature].requiredTool;
	return requiredTool === undefined || requiredTool in agentTools;
}
