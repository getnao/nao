/* @license Enterprise */

import type { Session } from 'better-auth';

import { env } from '../env';
import * as accountQueries from '../queries/account.queries';
import { hasSsoSessionExceededMaxAge } from '../utils/sso-session';
import { getOidcProviderId, isOidcConfigured } from './oidc-auth.service';

export async function shouldExpireSsoSession(session: Session): Promise<boolean> {
	if (
		!env.SSO_SESSION_MAX_AGE ||
		!isOidcConfigured() ||
		!hasSsoSessionExceededMaxAge(session.createdAt, env.SSO_SESSION_MAX_AGE)
	) {
		return false;
	}

	return accountQueries.hasAccountForProvider(session.userId, getOidcProviderId());
}
