/* @license Enterprise */

import { discoverOIDCConfig, DiscoveryError, type OIDCConfig } from '@better-auth/sso';

import type { DBOrganization, DBSsoProvider } from '../db/abstractSchema';
import { env } from '../env';
import * as orgQueries from '../queries/organization.queries';
import * as ssoProviderQueries from '../queries/sso-provider.queries';
import type { OrganizationSso, OrganizationSsoConfigInput } from '../types/organization';
import { HandlerError } from '../utils/error';
import { logger } from '../utils/logger';
import { isPublicEmailDomain, normalizeEmailDomains } from '../utils/utils';
import { hasFeature, LICENSE_FEATURES } from './license.service';

const SCOPES = ['openid', 'profile', 'email'];
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function getOrganizationSso(orgId: string): Promise<OrganizationSso | null> {
	await requireOrganization(orgId);
	const provider = await ssoProviderQueries.getSsoProviderByOrganizationId(orgId);
	return provider ? toOrganizationSso(provider) : null;
}

/** Staff only: the domains route every SSO sign-in on them to this organization. */
export async function activateOrganizationSso(orgId: string, requestedDomains: string[]): Promise<OrganizationSso> {
	const organization = await requireOrganization(orgId);
	const domains = normalizeEmailDomains(requestedDomains.join(','));
	await assertDomainsClaimable(orgId, domains);
	const existing = await ssoProviderQueries.getSsoProviderByOrganizationId(orgId);
	const saved = await ssoProviderQueries.upsertSsoProvider({
		organizationId: orgId,
		providerId: existing?.providerId ?? buildProviderId(organization),
		issuer: existing?.issuer ?? '',
		domain: domains.join(','),
		domainVerified: true,
	});
	logger.info('Backoffice activated organization SSO', { source: 'system', context: { orgId, domains } });
	return toOrganizationSso(saved);
}

export async function deactivateOrganizationSso(orgId: string): Promise<void> {
	await requireOrganization(orgId);
	if (!(await ssoProviderQueries.deleteSsoProviderByOrganizationId(orgId))) {
		throw new HandlerError('NOT_FOUND', 'SSO is not activated for this organization.');
	}
	logger.info('Backoffice deactivated organization SSO', { source: 'system', context: { orgId } });
}

/** Organization admins connect their IdP once nao staff have activated SSO for the organization. */
export async function configureOrganizationSso(
	orgId: string,
	input: OrganizationSsoConfigInput,
): Promise<OrganizationSso> {
	const existing = await ssoProviderQueries.getSsoProviderByOrganizationId(orgId);
	if (!existing) {
		throw new HandlerError('FORBIDDEN', 'SSO is not activated for this organization. Contact nao.');
	}
	const clientSecret = input.clientSecret ?? readOidcConfig(existing)?.clientSecret;
	if (!clientSecret) {
		throw new HandlerError('BAD_REQUEST', 'A client secret is required.');
	}
	const oidcConfig = await buildOidcConfig(input, clientSecret);
	const saved = await ssoProviderQueries.upsertSsoProvider({
		organizationId: orgId,
		providerId: existing.providerId,
		issuer: oidcConfig.issuer,
		domain: existing.domain,
		domainVerified: true,
		oidcConfig: JSON.stringify(oidcConfig),
	});
	logger.info('Organization SSO configured', { source: 'system', context: { orgId, issuer: oidcConfig.issuer } });
	return toOrganizationSso(saved);
}

async function requireOrganization(orgId: string): Promise<DBOrganization> {
	const organization = await orgQueries.getOrganizationById(orgId);
	if (!organization) {
		throw new HandlerError('NOT_FOUND', 'Organization not found');
	}
	return organization;
}

async function assertDomainsClaimable(orgId: string, domains: string[]): Promise<void> {
	if (domains.length === 0) {
		throw new HandlerError('BAD_REQUEST', 'At least one email domain is required.');
	}
	for (const domain of domains) {
		if (!DOMAIN_PATTERN.test(domain)) {
			throw new HandlerError('BAD_REQUEST', `"${domain}" is not a valid email domain.`);
		}
		if (isPublicEmailDomain(domain)) {
			throw new HandlerError('BAD_REQUEST', `"${domain}" is a public email provider and can't be used for SSO.`);
		}
		if (await orgQueries.isEmailDomainClaimedByAnotherOrg(domain, orgId)) {
			throw new HandlerError('CONFLICT', `"${domain}" is already claimed by another organization.`);
		}
	}
}

/**
 * Stores the IdP endpoints at save time: the plugin only discovers them at sign-in
 * for issuers listed in `trustedOrigins`, which would have to grow with every customer.
 */
async function buildOidcConfig(input: OrganizationSsoConfigInput, clientSecret: string): Promise<OIDCConfig> {
	const discovered = await discoverIssuer(input.issuer, input.discoveryUrl);
	return {
		issuer: discovered.issuer,
		discoveryEndpoint: discovered.discoveryEndpoint,
		authorizationEndpoint: discovered.authorizationEndpoint,
		tokenEndpoint: discovered.tokenEndpoint,
		jwksEndpoint: discovered.jwksEndpoint,
		userInfoEndpoint: discovered.userInfoEndpoint,
		tokenEndpointAuthentication: discovered.tokenEndpointAuthentication,
		clientId: input.clientId,
		clientSecret,
		pkce: true,
		scopes: SCOPES,
	};
}

async function discoverIssuer(issuer: string, discoveryUrl: string | undefined) {
	try {
		return await discoverOIDCConfig({ issuer, discoveryEndpoint: discoveryUrl, isTrustedOrigin: isHttpsUrl });
	} catch (error) {
		if (error instanceof DiscoveryError) {
			throw new HandlerError('BAD_REQUEST', `OIDC discovery failed: ${error.message}`);
		}
		throw error;
	}
}

function isHttpsUrl(url: string): boolean {
	return URL.parse(url)?.protocol === 'https:';
}

function buildProviderId(organization: DBOrganization): string {
	return `sso-${organization.slug}`;
}

/** `ssoLicensed` tells whether sign-in works yet: it is refused until the organization's license includes SSO. */
async function toOrganizationSso(provider: DBSsoProvider): Promise<OrganizationSso> {
	const oidcConfig = readOidcConfig(provider);
	return {
		providerId: provider.providerId,
		domains: normalizeEmailDomains(provider.domain),
		issuer: provider.issuer || null,
		clientId: oidcConfig?.clientId ?? null,
		hasClientSecret: !!oidcConfig?.clientSecret,
		redirectUri: new URL(`api/auth/sso/callback/${provider.providerId}`, withTrailingSlash(env.BETTER_AUTH_URL))
			.href,
		ssoLicensed: await hasFeature(LICENSE_FEATURES.sso, { orgId: provider.organizationId }),
		updatedAt: provider.updatedAt,
	};
}

function readOidcConfig(provider: DBSsoProvider | null): OIDCConfig | null {
	return provider?.oidcConfig ? (JSON.parse(provider.oidcConfig) as OIDCConfig) : null;
}

function withTrailingSlash(url: string): string {
	return url.endsWith('/') ? url : `${url}/`;
}
