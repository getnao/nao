import { eq } from 'drizzle-orm';

import s, { DBSsoProvider, NewSsoProvider } from '../db/abstractSchema';
import { db } from '../db/db';

export type SsoProviderSummary = Pick<DBSsoProvider, 'organizationId' | 'domain' | 'issuer'>;

export const getSsoProviderByOrganizationId = async (organizationId: string): Promise<DBSsoProvider | null> => {
	const [provider] = await db
		.select()
		.from(s.ssoProvider)
		.where(eq(s.ssoProvider.organizationId, organizationId))
		.execute();
	return provider ?? null;
};

export const getSsoProviderByProviderId = async (providerId: string): Promise<DBSsoProvider | null> => {
	const [provider] = await db.select().from(s.ssoProvider).where(eq(s.ssoProvider.providerId, providerId)).execute();
	return provider ?? null;
};

/** Leaves out the OIDC config, so that matching an email never decrypts every provider's secret. */
export const listSsoProviderSummaries = async (): Promise<SsoProviderSummary[]> => {
	return db
		.select({
			organizationId: s.ssoProvider.organizationId,
			domain: s.ssoProvider.domain,
			issuer: s.ssoProvider.issuer,
		})
		.from(s.ssoProvider)
		.execute();
};

export const upsertSsoProvider = async (provider: NewSsoProvider): Promise<DBSsoProvider> => {
	const { organizationId: _organizationId, providerId: _providerId, ...updatableFields } = provider;
	const [saved] = await db
		.insert(s.ssoProvider)
		.values(provider)
		.onConflictDoUpdate({ target: s.ssoProvider.organizationId, set: updatableFields })
		.returning()
		.execute();
	return saved;
};

/** Updates only the IdP connection, so it never restores domains or a provider that staff changed meanwhile. */
export const updateSsoProviderConnection = async (
	organizationId: string,
	connection: Pick<DBSsoProvider, 'issuer' | 'oidcConfig'>,
): Promise<DBSsoProvider | null> => {
	const [updated] = await db
		.update(s.ssoProvider)
		.set(connection)
		.where(eq(s.ssoProvider.organizationId, organizationId))
		.returning()
		.execute();
	return updated ?? null;
};

export const deleteSsoProviderByOrganizationId = async (organizationId: string): Promise<boolean> => {
	const deleted = await db
		.delete(s.ssoProvider)
		.where(eq(s.ssoProvider.organizationId, organizationId))
		.returning({ id: s.ssoProvider.id })
		.execute();
	return deleted.length > 0;
};
