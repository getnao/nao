/* @license Enterprise */

import { env } from '../env';
import * as orgQueries from '../queries/organization.queries';
import type { OrgRole } from '../types/organization';
import { logger, serializeError } from '../utils/logger';
import {
	decideGroupOrganizationRoleMapping,
	extractGroups,
	parseEntraGroupOrganizationRoleMapping,
	parseGroupOrganizationRoleMapping,
	resolveOrganizationRoleFromGroups,
} from '../utils/sso-group-mapping';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { isMicrosoftConfigured } from './microsoft-auth.service';
import { getOidcProviderId, isOidcConfigured } from './oidc-auth.service';
import { readDecodedIdTokenClaims, readVerifiedOidcIdTokenClaims } from './sso-token.service';

export const DEFAULT_GROUPS_CLAIM = 'groups';

/** When active the identity provider owns organization roles, so nao must not let them be edited by hand. */
export async function isOrganizationRoleMappingActive(): Promise<boolean> {
	if (!hasConfiguredOrganizationRoleMapping()) {
		return false;
	}
	return hasFeature(LICENSE_FEATURES.sso);
}

export async function isOidcOrganizationRoleMappingActive(): Promise<boolean> {
	if (!isOidcConfigured() || parseGroupOrganizationRoleMapping(env.OIDC_GROUP_NAO_ROLE_MAPPING).size === 0) {
		return false;
	}
	return hasFeature(LICENSE_FEATURES.sso);
}

export async function isMicrosoftOrganizationRoleMappingActive(): Promise<boolean> {
	const parsed = parseEntraGroupOrganizationRoleMapping(env.AZURE_AD_GROUP_NAO_ROLE_MAPPING);
	if (!isMicrosoftConfigured() || parsed.status !== 'valid' || parsed.mapping.size === 0) {
		return false;
	}
	return hasFeature(LICENSE_FEATURES.sso);
}

/**
 * Re-applies the identity provider's group memberships to a user's organization role.
 * Runs on every sign-in, so a group change in the IdP takes effect at the user's next login.
 * Never throws: a mapping failure must not stop someone from signing in.
 */
export async function syncOrganizationRoleFromSsoGroups(userId: string): Promise<void> {
	try {
		if (!(await isOidcOrganizationRoleMappingActive())) {
			return;
		}

		const token = await readVerifiedOidcIdTokenClaims(userId);
		if (token.status === 'no-token') {
			return;
		}

		if (token.status !== 'verified') {
			logger.warn('Could not verify the SSO ID token, leaving roles untouched', {
				source: 'system',
				context: { userId, problem: token.status },
			});
			return;
		}

		const claimName = env.OIDC_GROUPS_CLAIM ?? DEFAULT_GROUPS_CLAIM;
		const decision = decideGroupOrganizationRoleMapping(
			token.claims,
			claimName,
			parseGroupOrganizationRoleMapping(env.OIDC_GROUP_NAO_ROLE_MAPPING),
		);
		if (!decision.claimPresent) {
			logger.warn('The SSO groups claim is missing from the ID token, leaving roles untouched', {
				source: 'system',
				context: { userId, claimName },
			});
			return;
		}

		if (decision.organizationRole) {
			await applyOrganizationRole(userId, decision.organizationRole);
		}
	} catch (error) {
		logger.error('Failed to sync organization role from SSO groups', {
			source: 'system',
			context: { userId, error: serializeError(error) },
		});
	}
}

export async function syncOrganizationRoleFromMicrosoftGroups(userId: string, groupIds: string[]): Promise<void> {
	try {
		if (!(await isMicrosoftOrganizationRoleMappingActive())) {
			return;
		}
		const parsed = parseEntraGroupOrganizationRoleMapping(env.AZURE_AD_GROUP_NAO_ROLE_MAPPING);
		if (parsed.status !== 'valid') {
			return;
		}
		const organizationRole = resolveOrganizationRoleFromGroups(groupIds, parsed.mapping);
		if (organizationRole) {
			await applyOrganizationRole(userId, organizationRole);
		}
	} catch (error) {
		logger.error('Failed to sync organization role from Microsoft Entra groups', {
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
	resolvedOrganizationRole: OrgRole | null;
	mapping: Array<{ group: string; organizationRole: OrgRole }>;
	problem: SsoTokenProblem | null;
}

export type SsoTokenProblem = 'no-token' | 'undecodable' | 'claim-missing' | 'no-group-matched';

/**
 * Decodes the ID token nao stored at the user's last sign-in, so an admin can see exactly
 * which claims the identity provider sent and how they resolved to a role.
 */
export async function inspectSsoToken(userId: string): Promise<SsoTokenInspection> {
	const claimName = env.OIDC_GROUPS_CLAIM ?? DEFAULT_GROUPS_CLAIM;
	const roleMapping = parseGroupOrganizationRoleMapping(env.OIDC_GROUP_NAO_ROLE_MAPPING);
	const mapping = [...roleMapping].map(([group, organizationRole]) => ({ group, organizationRole }));
	const base = {
		providerId: getOidcProviderId(),
		claimName,
		mapping,
		claims: null,
		issuedAt: null,
		expiresAt: null,
		groups: [],
		matchedGroups: [],
		resolvedOrganizationRole: null,
	};

	const token = await readDecodedIdTokenClaims(userId, getOidcProviderId());
	if (token.status === 'no-token') {
		return { ...base, problem: 'no-token' };
	}
	if (token.status === 'undecodable') {
		return { ...base, problem: 'undecodable' };
	}
	const claims = token.claims;

	const groups = extractGroups(claims, claimName);
	const matchedGroups = groups.filter((group) => roleMapping.has(group.trim().toLowerCase()));

	return {
		...base,
		claims,
		issuedAt: toDate(claims.iat),
		expiresAt: toDate(claims.exp),
		groups,
		matchedGroups,
		resolvedOrganizationRole: resolveOrganizationRoleFromGroups(groups, roleMapping),
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

async function applyOrganizationRole(userId: string, role: OrgRole): Promise<void> {
	const membership = await orgQueries.getUserOrgMembership(userId);
	if (!membership || membership.role === role) {
		return;
	}

	if (await canDemoteOrgMember(membership.orgId, membership.role, role)) {
		await orgQueries.updateOrgMemberRole(membership.orgId, userId, role);
	}
}

function hasConfiguredOrganizationRoleMapping(): boolean {
	if (isOidcConfigured() && parseGroupOrganizationRoleMapping(env.OIDC_GROUP_NAO_ROLE_MAPPING).size > 0) {
		return true;
	}
	const entraMapping = parseEntraGroupOrganizationRoleMapping(env.AZURE_AD_GROUP_NAO_ROLE_MAPPING);
	return isMicrosoftConfigured() && entraMapping.status === 'valid' && entraMapping.mapping.size > 0;
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
