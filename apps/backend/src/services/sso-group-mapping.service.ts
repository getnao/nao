/* @license Enterprise */

import type { UserRole } from '@nao/shared/types';
import { decodeJwt } from 'jose';

import { env } from '../env';
import * as accountQueries from '../queries/account.queries';
import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import type { OrgRole } from '../types/organization';
import { logger, serializeError } from '../utils/logger';
import {
	decideGroupRoleMapping,
	extractGroups,
	parseGroupRoleMapping,
	resolveRoleFromGroups,
} from '../utils/sso-group-mapping';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { getOidcProviderId, isOidcConfigured } from './oidc-auth.service';

const DEFAULT_GROUPS_CLAIM = 'groups';

/** When active the identity provider owns roles, so nao must not let them be edited by hand. */
export async function isGroupRoleMappingActive(): Promise<boolean> {
	if (!isOidcConfigured() || parseGroupRoleMapping(env.OIDC_GROUP_ROLE_MAPPING).size === 0) {
		return false;
	}
	return hasFeature(LICENSE_FEATURES.sso);
}

/**
 * Re-applies the identity provider's group memberships to a user's nao roles.
 * Runs on every sign-in, so a group change in the IdP takes effect at the user's next login.
 * Never throws: a mapping failure must not stop someone from signing in.
 */
export async function syncRolesFromSsoGroups(userId: string): Promise<void> {
	if (!(await isGroupRoleMappingActive())) {
		return;
	}

	try {
		const token = await readClaimsFromIdToken(userId);
		if (token.status === 'no-token') {
			return;
		}

		if (token.status === 'undecodable') {
			logger.warn('Could not decode the SSO ID token, leaving roles untouched', {
				source: 'system',
				context: { userId },
			});
			return;
		}

		const claimName = env.OIDC_GROUPS_CLAIM ?? DEFAULT_GROUPS_CLAIM;
		const decision = decideGroupRoleMapping(
			token.claims,
			claimName,
			parseGroupRoleMapping(env.OIDC_GROUP_ROLE_MAPPING),
		);
		if (!decision.claimPresent) {
			logger.warn('The SSO groups claim is missing from the ID token, leaving roles untouched', {
				source: 'system',
				context: { userId, claimName },
			});
			return;
		}

		if (decision.role) {
			await applyRole(userId, decision.role);
		}
	} catch (error) {
		logger.error('Failed to sync roles from SSO groups', {
			source: 'system',
			context: { userId, error: serializeError(error) },
		});
	}
}

export interface SsoTokenInspection {
	providerId: string;
	claimName: string;
	claims: Record<string, unknown> | null;
	issuedAt: Date | null;
	expiresAt: Date | null;
	groups: string[];
	matchedGroups: string[];
	resolvedRole: UserRole | null;
	mapping: Array<{ group: string; role: UserRole }>;
	problem: SsoTokenProblem | null;
}

export type SsoTokenProblem = 'no-token' | 'undecodable' | 'claim-missing' | 'no-group-matched';

/**
 * Decodes the ID token nao stored at the user's last sign-in, so an admin can see exactly
 * which claims the identity provider sent and how they resolved to a role.
 */
export async function inspectSsoToken(userId: string): Promise<SsoTokenInspection> {
	const claimName = env.OIDC_GROUPS_CLAIM ?? DEFAULT_GROUPS_CLAIM;
	const roleMapping = parseGroupRoleMapping(env.OIDC_GROUP_ROLE_MAPPING);
	const mapping = [...roleMapping].map(([group, role]) => ({ group, role }));
	const base = {
		providerId: getOidcProviderId(),
		claimName,
		mapping,
		claims: null,
		issuedAt: null,
		expiresAt: null,
		groups: [],
		matchedGroups: [],
		resolvedRole: null,
	};

	const idToken = await accountQueries.getIdToken(userId, getOidcProviderId());
	if (!idToken) {
		return { ...base, problem: 'no-token' };
	}

	let claims: Record<string, unknown>;
	try {
		claims = decodeJwt(idToken);
	} catch {
		return { ...base, problem: 'undecodable' };
	}

	const groups = extractGroups(claims, claimName);
	const matchedGroups = groups.filter((group) => roleMapping.has(group.trim().toLowerCase()));

	return {
		...base,
		claims,
		issuedAt: toDate(claims.iat),
		expiresAt: toDate(claims.exp),
		groups,
		matchedGroups,
		resolvedRole: resolveRoleFromGroups(groups, roleMapping),
		problem: diagnose(claims, claimName, matchedGroups),
	};
}

function diagnose(claims: Record<string, unknown>, claimName: string, matchedGroups: string[]): SsoTokenProblem | null {
	if (!(claimName in claims)) {
		return 'claim-missing';
	}
	if (matchedGroups.length === 0) {
		return 'no-group-matched';
	}
	return null;
}

function toDate(seconds: unknown): Date | null {
	return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

type IdTokenClaims =
	| { status: 'no-token' }
	| { status: 'undecodable' }
	| { status: 'decoded'; claims: Record<string, unknown> };

async function readClaimsFromIdToken(userId: string): Promise<IdTokenClaims> {
	const idToken = await accountQueries.getIdToken(userId, getOidcProviderId());
	if (!idToken) {
		return { status: 'no-token' };
	}

	try {
		return { status: 'decoded', claims: decodeJwt(idToken) };
	} catch {
		return { status: 'undecodable' };
	}
}

/**
 * Organization membership has no `context_admin`, so it is stored as the closest equivalent
 * while the project membership keeps the full role.
 */
async function applyRole(userId: string, role: UserRole): Promise<void> {
	const membership = await orgQueries.getUserOrgMembership(userId);
	if (!membership) {
		return;
	}

	const orgRole: OrgRole = role === 'context_admin' ? 'user' : role;
	if (membership.role !== orgRole && (await canDemoteOrgMember(membership.orgId, membership.role, orgRole))) {
		await orgQueries.updateOrgMemberRole(membership.orgId, userId, orgRole);
	}

	for (const { projectId, projectPath, role: currentRole } of await projectQueries.listProjectMembershipsForUser(
		userId,
	)) {
		if (currentRole !== role && (await canDemoteProjectMember(projectId, currentRole, role))) {
			await projectQueries.updateProjectMemberRole(projectId, userId, role);
			await cleanupWorktreeAfterDemotion(projectId, projectPath, userId, currentRole, role);
		}
	}
}

async function cleanupWorktreeAfterDemotion(
	projectId: string,
	projectPath: string | null,
	userId: string,
	currentRole: UserRole,
	nextRole: UserRole,
): Promise<void> {
	if (
		!projectPath ||
		(currentRole !== 'admin' && currentRole !== 'context_admin') ||
		nextRole === 'admin' ||
		nextRole === 'context_admin'
	) {
		return;
	}

	try {
		const { cleanupContextWorktree } = await import('./context-explorer-git.service');
		await cleanupContextWorktree(projectId, projectPath, userId);
	} catch (error) {
		logger.warn('Failed to clean up context worktree after SSO group demotion', {
			source: 'system',
			context: { projectId, userId, error: serializeError(error) },
		});
	}
}

/** Guards the invariant that an organization keeps at least one admin. */
async function canDemoteOrgMember(orgId: string, currentRole: OrgRole, nextRole: OrgRole): Promise<boolean> {
	if (currentRole !== 'admin' || nextRole === 'admin') {
		return true;
	}

	if ((await orgQueries.countOrgAdmins(orgId)) > 1) {
		return true;
	}

	logger.warn('Skipped SSO group demotion of the last organization admin', {
		source: 'system',
		context: { orgId, nextRole },
	});
	return false;
}

/** Guards the invariant that a project keeps at least one admin. */
async function canDemoteProjectMember(projectId: string, currentRole: UserRole, nextRole: UserRole): Promise<boolean> {
	if (currentRole !== 'admin' || nextRole === 'admin') {
		return true;
	}

	if (await projectQueries.checkProjectHasMoreThanOneAdmin(projectId)) {
		return true;
	}

	logger.warn('Skipped SSO group demotion of the last project admin', {
		source: 'system',
		context: { projectId, nextRole },
	});
	return false;
}
