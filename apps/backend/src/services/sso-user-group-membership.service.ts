/* @license Enterprise */

import { env } from '../env';
import {
	hasSsoUserGroupSyncState,
	reconcileSsoUserGroupMemberships,
} from '../queries/sso-user-group-membership.queries';
import { logger, serializeError } from '../utils/logger';
import { parseOidcGroupNaoGroupMapping, readGroupsClaim } from '../utils/sso-group-mapping';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { isOidcConfigured } from './oidc-auth.service';
import { DEFAULT_GROUPS_CLAIM } from './sso-group-mapping.service';
import { readVerifiedOidcIdTokenClaims } from './sso-token.service';

export async function syncUserGroupsFromOidc(userId: string): Promise<void> {
	try {
		if (!(await canSyncOidcUserGroups(userId))) {
			return;
		}

		const token = await readVerifiedOidcIdTokenClaims(userId);
		if (token.status !== 'verified') {
			logger.warn('Could not read the OIDC groups claim, leaving User Group memberships untouched', {
				source: 'system',
				context: { userId, problem: token.status },
			});
			return;
		}

		const claimName = env.OIDC_GROUPS_CLAIM ?? DEFAULT_GROUPS_CLAIM;
		const claim = readGroupsClaim(token.claims, claimName);
		if (claim.status !== 'valid') {
			logger.warn('The OIDC groups claim is unavailable, leaving User Group memberships untouched', {
				source: 'system',
				context: { userId, claimName, problem: claim.status },
			});
			return;
		}

		const envMappings = parseOidcGroupNaoGroupMapping(env.OIDC_GROUP_NAO_GROUP_MAPPING);
		if (envMappings.status === 'invalid') {
			logger.error('Invalid OIDC User Group mapping, leaving memberships untouched', {
				source: 'system',
				context: { problem: envMappings.problem },
			});
			return;
		}
		await reconcileSsoUserGroupMemberships(userId, 'oidc', claim.groups, {
			hasUnlimitedUserGroups: await hasFeature(LICENSE_FEATURES.userGroups),
			oidcMappings: envMappings.mappings,
		});
	} catch (error) {
		logger.error('Failed to sync User Group memberships from OIDC', {
			source: 'system',
			context: { userId, error: serializeError(error) },
		});
	}
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
