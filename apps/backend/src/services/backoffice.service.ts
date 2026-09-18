/* @license Enterprise */

import fs from 'node:fs';
import path from 'node:path';

import type { UserRole } from '@nao/shared/types';

import * as backofficeQueries from '../queries/backoffice.queries';
import * as statsQueries from '../queries/backoffice-stats.queries';
import * as userQueries from '../queries/backoffice-user.queries';
import * as orgQueries from '../queries/organization.queries';
import type { OrgRole } from '../types/organization';
import { HandlerError } from '../utils/error';
import { extractConfiguredDatabases, extractRequiredEnvVars } from '../utils/nao-config';
import * as membershipService from './membership.service';

export async function getOrganizationDetail(orgId: string) {
	const organization = await requireOrganization(orgId);
	const [members, projects, apiKeys, stats] = await Promise.all([
		backofficeQueries.getOrganizationMembers(orgId),
		backofficeQueries.getOrganizationProjects(orgId),
		backofficeQueries.getOrganizationApiKeys(orgId),
		statsQueries.getOrganizationStats(orgId),
	]);
	return { organization: toOrganizationSummary(organization), members, projects, apiKeys, stats };
}

export async function updateOrganization(orgId: string, values: { name?: string }) {
	await requireOrganization(orgId);
	if (values.name !== undefined) {
		await orgQueries.updateOrganizationName(orgId, values.name);
	}
	return toOrganizationSummary(await requireOrganization(orgId));
}

export async function putOrganizationMember(orgId: string, userId: string, role: OrgRole) {
	return membershipService.putOrganizationMember(orgId, userId, role);
}

export async function removeOrganizationMember(orgId: string, userId: string): Promise<void> {
	return membershipService.removeOrganizationMember(orgId, userId);
}

export async function getProjectDetail(projectId: string) {
	const project = await requireProject(projectId);
	const [{ llmProviders, budgets }, members, stats] = await Promise.all([
		backofficeQueries.getProjectSecretMetadata(projectId),
		backofficeQueries.getProjectMembers(projectId),
		statsQueries.getProjectStats(projectId),
	]);
	const inspection = inspectProject(project);
	return {
		project: {
			id: project.id,
			orgId: project.orgId ?? '',
			orgName: project.orgName ?? '',
			name: project.name,
			type: project.type,
			hasPath: inspection.context.hasPath,
			createdAt: project.createdAt,
			updatedAt: project.updatedAt,
		},
		members,
		context: inspection.context,
		databases: inspection.databases,
		secrets: {
			envVarNames: inspection.context.setEnvVarNames,
			llmProviders: llmProviders.map((provider) => ({
				provider: provider.provider,
				hasApiKey: isSet(provider.apiKey),
				hasCredentials: isSet(provider.credentials),
				hasBaseUrl: isSet(provider.baseUrl),
				enabledModelCount: provider.enabledModels.length,
			})),
			messaging: {
				slack: project.slackSettings !== null,
				teams: project.teamsSettings !== null,
				telegram: project.telegramSettings !== null,
				mattermost: project.mattermostSettings !== null,
				whatsapp: project.whatsappSettings !== null,
			},
			mcpEndpointEnabled: project.mcpEndpointSettings?.enabled ?? false,
		},
		budgets: budgets.map((budget) => ({
			...budget,
			period: formatBudgetPeriod(budget.period),
		})),
		stats,
	};
}

export async function putProjectMember(projectId: string, userId: string, role: UserRole) {
	return membershipService.putProjectMember(projectId, userId, role);
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
	return membershipService.removeProjectMember(projectId, userId);
}

export async function getUserDetail(userId: string) {
	const user = await requireUser(userId);
	const [organizations, projects, usage] = await Promise.all([
		userQueries.getUserOrganizations(userId),
		userQueries.getUserProjects(userId),
		userQueries.getUserStats(userId),
	]);
	return { user: toUserSummary(user), organizations, projects, ...usage };
}

export async function updateUser(userId: string, values: { name?: string; email?: string }) {
	const user = await requireUser(userId);
	if (values.email !== undefined) {
		const owner = await userQueries.getUserByEmail(values.email);
		if (owner && owner.id !== userId) {
			throw new HandlerError('CONFLICT', 'Email is already in use');
		}
	}
	if (Object.keys(values).length === 0) {
		return toUserSummary(user);
	}
	const updated = await userQueries.updateUserForBackoffice(userId, values);
	return toUserSummary(updated!);
}

async function requireOrganization(orgId: string) {
	const organization = await backofficeQueries.getOrganizationForBackoffice(orgId);
	if (!organization) {
		throw new HandlerError('NOT_FOUND', 'Organization not found');
	}
	return organization;
}

async function requireProject(projectId: string) {
	const project = await backofficeQueries.getProjectForBackoffice(projectId);
	if (!project) {
		throw new HandlerError('NOT_FOUND', 'Project not found');
	}
	return project;
}

async function requireUser(userId: string) {
	const user = await userQueries.getUserForBackoffice(userId);
	if (!user) {
		throw new HandlerError('NOT_FOUND', 'User not found');
	}
	return user;
}

function inspectProject(project: Awaited<ReturnType<typeof requireProject>>) {
	const hasPath = isSet(project.path);
	const directoryExists = hasPath && isDirectory(project.path!);
	const naoConfigExists = directoryExists && fs.existsSync(path.join(project.path!, 'nao_config.yaml'));
	const requiredEnvVars = directoryExists ? extractRequiredEnvVars(project.path!) : [];
	const setEnvVarNames = Object.keys(project.envVars).sort();
	const missingEnvVars = requiredEnvVars.filter((name) => !isSet(project.envVars[name]));
	const configuredDatabases = directoryExists ? extractConfiguredDatabases(project.path!) : [];
	return {
		context: { hasPath, directoryExists, naoConfigExists, requiredEnvVars, setEnvVarNames, missingEnvVars },
		databases: configuredDatabases.map((database) => ({
			id: database.id,
			type: database.type ?? '',
			requiredEnvVars,
			missingEnvVars,
			configured: missingEnvVars.length === 0,
		})),
	};
}

function isDirectory(directoryPath: string): boolean {
	try {
		return fs.statSync(directoryPath).isDirectory();
	} catch {
		return false;
	}
}

function toOrganizationSummary(organization: Awaited<ReturnType<typeof requireOrganization>>) {
	return {
		id: organization.id,
		name: organization.name,
		slug: organization.slug,
		googleAuthDomains: (organization.googleAuthDomains ?? '')
			.split(',')
			.map((domain) => domain.trim())
			.filter(Boolean),
		hasGoogleSso: isSet(organization.googleClientId) && isSet(organization.googleClientSecret),
		createdAt: organization.createdAt,
		updatedAt: organization.updatedAt,
	};
}

function toUserSummary(user: NonNullable<Awaited<ReturnType<typeof userQueries.getUserForBackoffice>>>) {
	return {
		id: user.id,
		name: user.name,
		email: user.email,
		emailVerified: user.emailVerified,
		image: user.image,
		requiresPasswordReset: user.requiresPasswordReset,
		memoryEnabled: user.memoryEnabled,
		hasGithubToken: isSet(user.githubAccessToken),
		hasGitlabToken: isSet(user.gitlabAccessToken),
		createdAt: user.createdAt,
		updatedAt: user.updatedAt,
	};
}

function formatBudgetPeriod(period: 'day' | 'week' | 'month'): 'daily' | 'weekly' | 'monthly' {
	if (period === 'day') {
		return 'daily';
	}
	if (period === 'week') {
		return 'weekly';
	}
	return 'monthly';
}

function isSet(value: unknown): boolean {
	if (typeof value === 'string') {
		return value.trim().length > 0;
	}
	if (value && typeof value === 'object') {
		return Object.keys(value).length > 0;
	}
	return value !== null && value !== undefined;
}
