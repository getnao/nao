/* @license Enterprise */

import { sso } from '@better-auth/sso';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError } from 'better-auth';

import { env, isCloud } from '../env';
import * as orgQueries from '../queries/organization.queries';
import * as ssoProviderQueries from '../queries/sso-provider.queries';
import { getEmailDomain, isDomainCoveredBy, normalizeEmailDomains } from '../utils/utils';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { addOrganizationMemberIfMissing } from './membership.service';

export const CLOUD_SSO_SIGN_IN_PATH = '/sign-in/sso';

/**
 * Provider management endpoints of the SSO plugin. Providers are written by the
 * backoffice only, since a provider's domain routes every sign-in on that domain.
 */
const CLOUD_SSO_MANAGEMENT_PATHS = [
	'/sso/register',
	'/sso/providers',
	'/sso/get-provider',
	'/sso/update-provider',
	'/sso/delete-provider',
	'/sso/request-domain-verification',
	'/sso/verify-domain',
];

export function augmentPluginsWithCloudSso(plugins: BetterAuthPlugin[]): void {
	if (!isCloud) {
		return;
	}

	plugins.push(
		sso({
			providersLimit: 0,
			domainVerification: { enabled: true },
			organizationProvisioning: { disabled: true },
			provisionUserOnEveryLogin: true,
			provisionUser: addUserToProviderOrganization,
		}),
	);
}

export function getCloudSsoDisabledPaths(): string[] {
	return isCloud ? CLOUD_SSO_MANAGEMENT_PATHS : [];
}

export async function findCloudSsoOrganizationId(providerId: string | undefined): Promise<string | null> {
	if (!isCloud || !providerId) {
		return null;
	}
	const provider = await ssoProviderQueries.getSsoProviderByProviderId(providerId);
	return provider?.organizationId ?? null;
}

/** An SSO identity on one of the provider's own domains: the organization's IdP vouches for the address. */
export async function isCloudSsoEmailTrusted(providerId: string | undefined, email: string): Promise<boolean> {
	if (!isCloud || !providerId) {
		return false;
	}
	const provider = await ssoProviderQueries.getSsoProviderByProviderId(providerId);
	const emailDomain = getEmailDomain(email);
	return (
		!!provider?.domainVerified &&
		!!emailDomain &&
		isDomainCoveredBy(emailDomain, normalizeEmailDomains(provider.domain))
	);
}

/** One answer for every refusal, so that sign-in attempts never reveal which domains use SSO. */
const SSO_SIGN_IN_REFUSED = "We couldn't sign you in with SSO. Check your email or contact your admin.";

/** Refuses an SSO sign-in unless the organization's IdP is connected and its license includes SSO. */
export async function assertCloudSsoSignInAllowed(body: unknown): Promise<void> {
	const provider = await resolveSignInProvider(parseSignInBody(body));
	const isAllowed =
		!!provider?.issuer && (await hasFeature(LICENSE_FEATURES.sso, { orgId: provider.organizationId }));
	if (!isAllowed) {
		throw new APIError('FORBIDDEN', { message: SSO_SIGN_IN_REFUSED });
	}
}

interface SsoSignInTarget {
	providerId?: string;
	organizationSlug?: string;
	domain?: string;
}

async function resolveSignInProvider(target: SsoSignInTarget): Promise<ssoProviderQueries.SsoProviderSummary | null> {
	if (target.providerId) {
		return ssoProviderQueries.getSsoProviderByProviderId(target.providerId);
	}
	if (target.organizationSlug) {
		const organization = await orgQueries.getOrganizationBySlug(target.organizationSlug);
		return organization ? ssoProviderQueries.getSsoProviderByOrganizationId(organization.id) : null;
	}
	if (target.domain) {
		const domain = target.domain;
		const providers = await ssoProviderQueries.listSsoProviderSummaries();
		return providers.find((provider) => isDomainCoveredBy(domain, normalizeEmailDomains(provider.domain))) ?? null;
	}
	return null;
}

function parseSignInBody(body: unknown): SsoSignInTarget {
	const fields = (body ?? {}) as Record<string, unknown>;
	const email = readString(fields.email);
	return {
		providerId: readString(fields.providerId),
		organizationSlug: readString(fields.organizationSlug),
		domain: readString(fields.domain) ?? (email ? (getEmailDomain(email) ?? undefined) : undefined),
	};
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Runs on every SSO login, so existing users who link their IdP identity also join the organization. */
async function addUserToProviderOrganization({
	user,
	provider,
}: {
	user: { id: string };
	provider: { organizationId?: string | null };
}): Promise<void> {
	if (provider.organizationId) {
		await addOrganizationMemberIfMissing({
			orgId: provider.organizationId,
			userId: user.id,
			role: env.DEFAULT_USER_ROLE,
		});
	}
}
