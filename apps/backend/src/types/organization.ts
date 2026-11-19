import { z } from 'zod/v4';

export type OrgRole = 'admin' | 'user' | 'viewer';

export const ORG_ROLES = ['admin', 'user', 'viewer'] as const satisfies readonly OrgRole[];

export const organizationSsoDomainsInputSchema = z
	.object({ domains: z.array(z.string().trim().min(1)).min(1).max(20) })
	.strict();

export const organizationSsoConfigInputSchema = z.object({
	issuer: z.url({ protocol: /^https$/ }),
	discoveryUrl: z.url({ protocol: /^https$/ }).optional(),
	clientId: z.string().trim().min(1),
	clientSecret: z.string().trim().min(1).optional(),
});

export type OrganizationSsoConfigInput = z.infer<typeof organizationSsoConfigInputSchema>;

/** nao staff activate SSO and set the domains, then an organization admin connects their IdP. */
export interface OrganizationSso {
	providerId: string;
	domains: string[];
	issuer: string | null;
	clientId: string | null;
	hasClientSecret: boolean;
	/** The sign-in redirect URI to register in the customer's IdP application. */
	redirectUri: string;
	ssoLicensed: boolean;
	updatedAt: Date;
}
