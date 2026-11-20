/* @license Enterprise */

import { discoverOIDCConfig, DiscoveryError, type OIDCConfig } from '@better-auth/sso';

import type { DBOrganization, DBSsoProvider } from '../db/abstractSchema';
import { env } from '../env';
import * as orgQueries from '../queries/organization.queries';
import * as ssoProviderQueries from '../queries/sso-provider.queries';
import type { OrganizationSso, OrganizationSsoConfigInput } from '../types/organization';
import { HandlerError } from '../utils/error';
import { logger } from '../utils/logger';
import { assertSafeHost, isPrivateHostname } from '../utils/safe-fetch';
import { isPublicEmailDomain, normalizeEmailDomains } from '../utils/utils';
import { hasFeature, LICENSE_FEATURES } from './license.service';

const SCOPES = ['openid', 'profile', 'email'];
const NOT_ACTIVATED_MESSAGE = 'SSO is not activated for this organization. Contact nao.';
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
	const existing = await ssoProviderQueries.getSsoProviderByOrganizationId(orgId);
	if (!existing || !(await ssoProviderQueries.deleteSsoProviderByOrganizationId(orgId))) {
		throw new HandlerError('NOT_FOUND', 'SSO is not activated for this organization.');
	}
	await ssoProviderQueries.clearProviderAccountTokens(existing.providerId);
	logger.info('Backoffice deactivated organization SSO', { source: 'system', context: { orgId } });
}

/** Organization admins connect their IdP once nao staff have activated SSO for the organization. */
export async function configureOrganizationSso(
	orgId: string,
	input: OrganizationSsoConfigInput,
): Promise<OrganizationSso> {
	const existing = await ssoProviderQueries.getSsoProviderByOrganizationId(orgId);
	if (!existing) {
		throw new HandlerError('FORBIDDEN', NOT_ACTIVATED_MESSAGE);
	}
	const existingConfig = readOidcConfig(existing);
	const discovered = await discoverIssuer(input.issuer, input.discoveryUrl);
	const isSameIdp = !!existingConfig && isSameIdpApplication(existingConfig, discovered, input.clientId);
	const clientSecret = input.clientSecret ?? (isSameIdp ? existingConfig.clientSecret : undefined);
	if (!clientSecret) {
		throw new HandlerError(
			'BAD_REQUEST',
			existingConfig
				? 'Enter the client secret again when the IdP application changes.'
				: 'A client secret is required.',
		);
	}
	if (!isSameIdp) {
		await ssoProviderQueries.clearProviderAccountTokens(existing.providerId);
	}
	const oidcConfig = buildOidcConfig(discovered, input, clientSecret);
	const saved = await ssoProviderQueries.updateSsoProviderConnection(orgId, {
		issuer: oidcConfig.issuer,
		oidcConfig: JSON.stringify(oidcConfig),
	});
	if (!saved) {
		throw new HandlerError('FORBIDDEN', NOT_ACTIVATED_MESSAGE);
	}
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
		if (await orgQueries.isEmailDomainClaimedByAnotherOrg(domain, orgId, { includeSubdomains: true })) {
			throw new HandlerError('CONFLICT', `"${domain}" is already claimed by another organization.`);
		}
	}
}

/**
 * Stores the IdP endpoints at save time: the plugin only discovers them at sign-in
 * for issuers listed in `trustedOrigins`, which would have to grow with every customer.
 */
function buildOidcConfig(
	discovered: Awaited<ReturnType<typeof discoverIssuer>>,
	input: OrganizationSsoConfigInput,
	clientSecret: string,
): OIDCConfig {
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
		scopes: [...new Set([...SCOPES, ...input.additionalScopes])],
	};
}

/**
 * Members' stored refresh tokens and the kept client secret are sent to the token endpoint,
 * so they only carry over while the issuer, token endpoint and client stay the same.
 */
function isSameIdpApplication(
	existing: OIDCConfig,
	discovered: Awaited<ReturnType<typeof discoverIssuer>>,
	clientId: string,
): boolean {
	return (
		existing.issuer === discovered.issuer &&
		existing.tokenEndpoint === discovered.tokenEndpoint &&
		existing.clientId === clientId
	);
}

async function discoverIssuer(issuer: string, discoveryUrl: string | undefined) {
	await assertPublicHost(discoveryUrl ?? issuer);
	try {
		return await discoverOIDCConfig({ issuer, discoveryEndpoint: discoveryUrl, isTrustedOrigin: isPublicHttpsUrl });
	} catch (error) {
		if (error instanceof DiscoveryError) {
			throw new HandlerError('BAD_REQUEST', `OIDC discovery failed: ${error.message}`);
		}
		throw error;
	}
}

/** The server fetches this URL for an organization admin, so it must not lead inside the server's own network. */
async function assertPublicHost(url: string): Promise<void> {
	const hostname = URL.parse(url)?.hostname;
	if (!hostname) {
		return;
	}
	try {
		await assertSafeHost(hostname);
	} catch (error) {
		throw new HandlerError('BAD_REQUEST', `OIDC discovery failed: ${(error as Error).message}`);
	}
}

function isPublicHttpsUrl(url: string): boolean {
	const parsed = URL.parse(url);
	return parsed?.protocol === 'https:' && !isPrivateHostname(parsed.hostname);
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
		additionalScopes: (oidcConfig?.scopes ?? []).filter((scope) => !SCOPES.includes(scope)),
		redirectUri: new URL(`api/auth/sso/callback/${provider.providerId}`, withTrailingSlash(env.BETTER_AUTH_URL))
			.href,
		ssoLicensed: await hasFeature(LICENSE_FEATURES.sso, { orgId: provider.organizationId }),
		updatedAt: provider.updatedAt,
	};
}

export function readOidcConfig(provider: DBSsoProvider | null): OIDCConfig | null {
	return provider?.oidcConfig ? (JSON.parse(provider.oidcConfig) as OIDCConfig) : null;
}

function withTrailingSlash(url: string): string {
	return url.endsWith('/') ? url : `${url}/`;
}
