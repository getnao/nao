/* @license Enterprise */

import { isMicrosoftEntraGroupId, normalizeSsoGroupIdentifiers } from '@nao/shared';

import { env } from '../env';
import * as accountQueries from '../queries/account.queries';
import {
	hasSsoUserGroupSyncState,
	listConfiguredSsoGroupIdentifiers,
	listSsoProjectRoleCandidates,
	reconcileSsoUserGroupMemberships,
} from '../queries/sso-user-group-membership.queries';
import { logger, serializeError } from '../utils/logger';
import {
	type EntraGroupNaoGroupMapping,
	hasMicrosoftGroupsOverage,
	parseEntraGroupNaoGroupMapping,
	parseEntraGroupOrganizationRoleMapping,
	readGroupsClaim,
} from '../utils/sso-group-mapping';
import { chunk } from '../utils/utils';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { putProjectMember, type SeatActivationOutcome } from './membership.service';
import { isMicrosoftConfigured } from './microsoft-auth.service';
import { syncOrganizationRoleFromMicrosoftGroups } from './sso-group-mapping.service';
import { verifyMicrosoftIdTokenClaims } from './sso-token.service';

const MICROSOFT_PROVIDER_ID = 'microsoft';
const MICROSOFT_GROUPS_CLAIM = 'groups';
const GRAPH_CHECK_MEMBER_OBJECTS_URL = 'https://graph.microsoft.com/v1.0/me/checkMemberObjects';
const GRAPH_BATCH_SIZE = 20;
const GRAPH_TIMEOUT_MS = 10_000;

export async function syncUserGroupsFromMicrosoft(userId: string): Promise<SeatActivationOutcome | null> {
	try {
		if (!(await canSyncMicrosoftUserGroups(userId))) {
			return null;
		}

		const envMappings = parseEntraGroupNaoGroupMapping(env.AZURE_AD_GROUP_NAO_GROUP_MAPPING);
		const roleMapping = parseEntraGroupOrganizationRoleMapping(env.AZURE_AD_GROUP_NAO_ROLE_MAPPING);
		if (envMappings.status !== 'valid' || roleMapping.status !== 'valid') {
			logger.error('Invalid Microsoft Entra group mapping, leaving access unchanged', {
				source: 'system',
				context: { userId },
			});
			return null;
		}
		const hasUnlimitedUserGroups = await hasFeature(LICENSE_FEATURES.userGroups);
		const hasUserGroupSyncState =
			envMappings.mappings.length > 0 || (await hasSsoUserGroupSyncState(userId, MICROSOFT_PROVIDER_ID));
		const tokens = await accountQueries.getLoginTokens(userId, MICROSOFT_PROVIDER_ID);
		const token = await verifyMicrosoftIdTokenClaims(tokens?.idToken ?? null);
		if (token.status !== 'verified') {
			logger.warn('Could not read the Microsoft ID token, leaving User Group memberships untouched', {
				source: 'system',
				context: { userId, problem: token.status },
			});
			return null;
		}

		const directGroups = readGroupsClaim(token.claims, MICROSOFT_GROUPS_CLAIM);
		if (directGroups.status === 'valid') {
			const groupIds = normalizeMicrosoftGroupIds(directGroups.groups);
			if (!groupIds) {
				logUnavailableMemberships(userId, 'malformed-groups-claim');
				return null;
			}
			return await synchronizeMicrosoftMappings(
				userId,
				groupIds,
				hasUserGroupSyncState,
				hasUnlimitedUserGroups,
				envMappings.mappings,
			);
		}
		if (directGroups.status === 'malformed') {
			logUnavailableMemberships(userId, 'malformed-groups-claim');
			return null;
		}
		if (!hasMicrosoftGroupsOverage(token.claims)) {
			logUnavailableMemberships(userId, 'groups-claim-missing');
			return null;
		}

		const uiCandidateIds = hasUserGroupSyncState
			? await listConfiguredSsoGroupIdentifiers(userId, MICROSOFT_PROVIDER_ID, hasUnlimitedUserGroups)
			: [];
		const candidateIds = normalizeSsoGroupIdentifiers('microsoft', [
			...uiCandidateIds,
			...envMappings.mappings.map((mapping) => mapping.entraGroupId),
			...roleMapping.mapping.keys(),
		]).filter(isMicrosoftEntraGroupId);
		if (candidateIds.length === 0) {
			return await synchronizeMicrosoftMappings(
				userId,
				[],
				hasUserGroupSyncState,
				hasUnlimitedUserGroups,
				envMappings.mappings,
			);
		}
		if (!hasFreshAccessToken(tokens)) {
			logUnavailableMemberships(userId, 'access-token-unavailable');
			return null;
		}

		const resolvedIds = await resolveMicrosoftGraphMemberships(tokens.accessToken, candidateIds);
		return await synchronizeMicrosoftMappings(
			userId,
			resolvedIds,
			hasUserGroupSyncState,
			hasUnlimitedUserGroups,
			envMappings.mappings,
		);
	} catch (error) {
		logger.error('Failed to sync User Group memberships from Microsoft Entra', {
			source: 'system',
			context: { userId, error: serializeError(error) },
		});
		return null;
	}
}

async function synchronizeMicrosoftMappings(
	userId: string,
	groupIds: string[],
	hasUserGroupSyncState: boolean,
	hasUnlimitedUserGroups: boolean,
	envMappings: EntraGroupNaoGroupMapping[],
): Promise<SeatActivationOutcome | null> {
	let outcome: SeatActivationOutcome | null = null;
	try {
		if (hasUserGroupSyncState) {
			const options = {
				hasUnlimitedUserGroups,
				entraMappings: envMappings,
			};
			for (const candidate of await listSsoProjectRoleCandidates(
				userId,
				MICROSOFT_PROVIDER_ID,
				groupIds,
				options,
			)) {
				const result = await putProjectMember(candidate.projectId, userId, candidate.role);
				if (
					result.outcome &&
					(!outcome ||
						result.outcome.status === 'viewer_fallback' ||
						result.outcome.status === 'promotion_rejected')
				) {
					outcome = result.outcome;
				}
			}
			await reconcileSsoUserGroupMemberships(userId, MICROSOFT_PROVIDER_ID, groupIds, options);
		}
	} finally {
		await syncOrganizationRoleFromMicrosoftGroups(userId, groupIds);
	}
	return outcome;
}

export async function resolveMicrosoftGraphMemberships(
	accessToken: string,
	candidateIds: string[],
	fetcher: typeof fetch = fetch,
): Promise<string[]> {
	const normalizedIds = normalizeSsoGroupIdentifiers('microsoft', candidateIds);
	const batches = chunk(normalizedIds, GRAPH_BATCH_SIZE);
	const results = await Promise.all(
		batches.map(async (ids) => {
			const response = await fetcher(GRAPH_CHECK_MEMBER_OBJECTS_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ ids }),
				signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
			});
			if (!response.ok) {
				throw new Error(`Microsoft Graph membership check failed with status ${response.status}`);
			}

			const data: unknown = await response.json();
			if (!isValidGraphResponse(data, ids)) {
				throw new Error('Microsoft Graph returned a malformed membership response');
			}
			return normalizeSsoGroupIdentifiers('microsoft', data.value);
		}),
	);

	return [...new Set(results.flat())];
}

async function canSyncMicrosoftUserGroups(userId: string): Promise<boolean> {
	if (!isMicrosoftConfigured()) {
		return false;
	}
	if (!(await hasFeature(LICENSE_FEATURES.sso))) {
		return false;
	}
	const envMappings = parseEntraGroupNaoGroupMapping(env.AZURE_AD_GROUP_NAO_GROUP_MAPPING);
	const roleMapping = parseEntraGroupOrganizationRoleMapping(env.AZURE_AD_GROUP_NAO_ROLE_MAPPING);
	if (
		(envMappings.status === 'valid' && envMappings.mappings.length > 0) ||
		(roleMapping.status === 'valid' && roleMapping.mapping.size > 0)
	) {
		return true;
	}
	return hasSsoUserGroupSyncState(userId, MICROSOFT_PROVIDER_ID);
}

function normalizeMicrosoftGroupIds(values: string[]): string[] | null {
	if (!values.every(isMicrosoftEntraGroupId)) {
		return null;
	}
	return normalizeSsoGroupIdentifiers('microsoft', values);
}

function hasFreshAccessToken(tokens: accountQueries.LoginTokens | null): tokens is accountQueries.LoginTokens & {
	accessToken: string;
} {
	return (
		!!tokens?.accessToken && (!tokens.accessTokenExpiresAt || tokens.accessTokenExpiresAt.getTime() > Date.now())
	);
}

function isValidGraphResponse(value: unknown, requestedIds: string[]): value is { value: string[] } {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const memberships = (value as Record<string, unknown>).value;
	if (!Array.isArray(memberships) || !memberships.every((membership) => typeof membership === 'string')) {
		return false;
	}
	const requested = new Set(requestedIds);
	return memberships.every(
		(membership) =>
			isMicrosoftEntraGroupId(membership) &&
			requested.has(normalizeSsoGroupIdentifiers('microsoft', [membership])[0]),
	);
}

function logUnavailableMemberships(userId: string, problem: string): void {
	logger.warn('Microsoft Entra group membership is unavailable, leaving User Group memberships untouched', {
		source: 'system',
		context: { userId, problem },
	});
}
