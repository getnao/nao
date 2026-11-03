/* @license Enterprise */

import { env } from '../env';
import {
	hasSsoUserGroupSyncState,
	listSsoProjectRoleCandidates,
	reconcileSsoUserGroupMemberships,
} from '../queries/sso-user-group-membership.queries';
import { logger, serializeError } from '../utils/logger';
import { parseOidcGroupNaoGroupMapping, readGroupsClaim } from '../utils/sso-group-mapping';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { putProjectMember, type SeatActivationOutcome } from './membership.service';
import { isOidcConfigured } from './oidc-auth.service';
import { DEFAULT_GROUPS_CLAIM } from './sso-group-mapping.service';
import { readVerifiedOidcIdTokenClaims } from './sso-token.service';

export async function syncUserGroupsFromOidc(userId: string): Promise<SeatActivationOutcome | null> {
	try {
		if (!(await canSyncOidcUserGroups(userId))) {
			return null;
		}

		const token = await readVerifiedOidcIdTokenClaims(userId);
		if (token.status !== 'verified') {
			logger.warn('Could not read the OIDC groups claim, leaving User Group memberships untouched', {
				source: 'system',
				context: { userId, problem: token.status },
			});
			return null;
		}

		const claimName = env.OIDC_GROUPS_CLAIM ?? DEFAULT_GROUPS_CLAIM;
		const claim = readGroupsClaim(token.claims, claimName);
		if (claim.status !== 'valid') {
			logger.warn('The OIDC groups claim is unavailable, leaving User Group memberships untouched', {
				source: 'system',
				context: { userId, claimName, problem: claim.status },
			});
			return null;
		}

		const envMappings = parseOidcGroupNaoGroupMapping(env.OIDC_GROUP_NAO_GROUP_MAPPING);
		if (envMappings.status === 'invalid') {
			logger.error('Invalid OIDC User Group mapping, leaving memberships untouched', {
				source: 'system',
				context: { problem: envMappings.problem },
			});
			return null;
		}
		const options = {
			hasUnlimitedUserGroups: await hasFeature(LICENSE_FEATURES.userGroups),
			oidcMappings: envMappings.mappings,
		};
		const outcomes: SeatActivationOutcome[] = [];
		for (const candidate of await listSsoProjectRoleCandidates(userId, 'oidc', claim.groups, options)) {
			const result = await putProjectMember(candidate.projectId, userId, candidate.role);
			if (result.outcome) {
				outcomes.push(result.outcome);
			}
		}
		await reconcileSsoUserGroupMemberships(userId, 'oidc', claim.groups, options);
		return mostRestrictiveOutcome(outcomes);
	} catch (error) {
		logger.error('Failed to sync User Group memberships from OIDC', {
			source: 'system',
			context: { userId, error: serializeError(error) },
		});
		return null;
	}
}

function mostRestrictiveOutcome(outcomes: SeatActivationOutcome[]): SeatActivationOutcome | null {
	return (
		outcomes.find(({ status }) => status === 'viewer_fallback' || status === 'promotion_rejected') ??
		outcomes.at(-1) ??
		null
	);
}

async function canSyncOidcUserGroups(userId: string): Promise<boolean> {
	if (!isOidcConfigured()) {
		return false;
	}
	if (!(await hasFeature(LICENSE_FEATURES.sso))) {
		return false;
	}
	const envMappings = parseOidcGroupNaoGroupMapping(env.OIDC_GROUP_NAO_GROUP_MAPPING);
	if (envMappings.status === 'valid' && envMappings.mappings.length > 0) {
		return true;
	}
	return hasSsoUserGroupSyncState(userId, 'oidc');
}
