/* @license Enterprise */

import { decodeJwt } from 'jose';

import * as accountQueries from '../queries/account.queries';

export type IdTokenClaims =
	| { status: 'no-token' }
	| { status: 'undecodable' }
	| { status: 'decoded'; claims: Record<string, unknown> };

export async function readClaimsFromIdToken(userId: string, providerId: string): Promise<IdTokenClaims> {
	const idToken = await accountQueries.getIdToken(userId, providerId);
	return decodeIdTokenClaims(idToken);
}

export function decodeIdTokenClaims(idToken: string | null): IdTokenClaims {
	if (!idToken) {
		return { status: 'no-token' };
	}

	try {
		return { status: 'decoded', claims: decodeJwt(idToken) };
	} catch {
		return { status: 'undecodable' };
	}
}
