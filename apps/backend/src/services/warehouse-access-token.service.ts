/* @license Enterprise */

import { hasFeature, LICENSE_FEATURES } from './license.service';
import { getAzureAccessTokenForUser } from './microsoft-auth.service';
import { getOidcAccessTokenForUser } from './oidc-access-token.service';

/**
 * The access token of the user's identity provider, for warehouses that run queries as the signed-in user
 * (Redshift with Microsoft Entra ID, Snowflake External OAuth). Always null in the open-source edition.
 */
export async function getWarehouseAccessTokenForUser(userId: string): Promise<string | null> {
	if (!(await hasFeature(LICENSE_FEATURES.sso))) {
		return null;
	}
	return (await getAzureAccessTokenForUser(userId)) ?? (await getOidcAccessTokenForUser(userId));
}
