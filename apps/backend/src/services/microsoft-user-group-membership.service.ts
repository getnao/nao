/* @license Enterprise */

import { isMicrosoftEntraGroupId, normalizeSsoGroupIdentifiers } from '@nao/shared';

import * as accountQueries from '../queries/account.queries';
import {
	hasSsoUserGroupSyncState,
	listConfiguredSsoGroupIdentifiers,
	reconcileSsoUserGroupMemberships,
} from '../queries/sso-user-group-membership.queries';
import { logger, serializeError } from '../utils/logger';
import { readGroupsClaim } from '../utils/sso-group-mapping';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { isMicrosoftConfigured } from './microsoft-auth.service';
import { decodeIdTokenClaims } from './sso-token.service';

const MICROSOFT_PROVIDER_ID = 'microsoft';
const MICROSOFT_GROUPS_CLAIM = 'groups';
const GRAPH_CHECK_MEMBER_OBJECTS_URL = 'https://graph.microsoft.com/v1.0/me/checkMemberObjects';
const GRAPH_BATCH_SIZE = 20;
const GRAPH_TIMEOUT_MS = 10_000;

export async function syncUserGroupsFromMicrosoft(userId: string): Promise<void> {
	try {
		if (!(await canSyncMicrosoftUserGroups(userId))) {
			return;
		}

		const tokens = await accountQueries.getLoginTokens(userId, MICROSOFT_PROVIDER_ID);
		const token = decodeIdTokenClaims(tokens?.idToken ?? null);
		if (token.status !== 'decoded') {
			logger.warn('Could not read the Microsoft ID token, leaving User Group memberships untouched', {
				source: 'system',
				context: { userId, problem: token.status },
			});
			return;
		}

		const directGroups = readGroupsClaim(token.claims, MICROSOFT_GROUPS_CLAIM);
		if (directGroups.status === 'valid') {
			const groupIds = normalizeMicrosoftGroupIds(directGroups.groups);
			if (!groupIds) {
				logUnavailableMemberships(userId, 'malformed-groups-claim');
				return;
			}
			await reconcileSsoUserGroupMemberships(userId, MICROSOFT_PROVIDER_ID, groupIds);
			return;
		}
		if (directGroups.status === 'malformed') {
			logUnavailableMemberships(userId, 'malformed-groups-claim');
			return;
		}
		if (!hasMicrosoftGroupsOverage(token.claims)) {
			logUnavailableMemberships(userId, 'groups-claim-missing');
			return;
		}

		const candidateIds = (await listConfiguredSsoGroupIdentifiers(userId, MICROSOFT_PROVIDER_ID)).filter(
			isMicrosoftEntraGroupId,
		);
		if (candidateIds.length === 0) {
			await reconcileSsoUserGroupMemberships(userId, MICROSOFT_PROVIDER_ID, []);
			return;
		}
		if (!hasFreshAccessToken(tokens)) {
			logUnavailableMemberships(userId, 'access-token-unavailable');
			return;
		}

		const resolvedIds = await resolveMicrosoftGraphMemberships(tokens.accessToken, candidateIds);
		await reconcileSsoUserGroupMemberships(userId, MICROSOFT_PROVIDER_ID, resolvedIds);
	} catch (error) {
		logger.error('Failed to sync User Group memberships from Microsoft Entra', {
			source: 'system',
			context: { userId, error: serializeError(error) },
		});
	}
}

export function hasMicrosoftGroupsOverage(claims: Record<string, unknown>): boolean {
	const claimNames = claims._claim_names;
	const hasClaimName =
		claimNames !== null &&
		typeof claimNames === 'object' &&
		!Array.isArray(claimNames) &&
		typeof (claimNames as Record<string, unknown>).groups === 'string';
	return hasClaimName || claims.hasgroups === true;
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
	if (!(await hasFeature(LICENSE_FEATURES.userGroups))) {
		return false;
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

function chunk<T>(values: T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
		values.slice(index * size, (index + 1) * size),
	);
}

function logUnavailableMemberships(userId: string, problem: string): void {
	logger.warn('Microsoft Entra group membership is unavailable, leaving User Group memberships untouched', {
		source: 'system',
		context: { userId, problem },
	});
}
