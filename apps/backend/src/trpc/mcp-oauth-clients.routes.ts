import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod/v4';

import { getAuth } from '../auth';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import { isCloud } from '../env';
import { adminProtectedProcedure, router } from './trpc';

/**
 * OAuth clients live in a single, deployment-wide table (better-auth has no per-workspace scoping),
 * so managing them is restricted to self-hosted deployments — where "the deployment" is the
 * workspace. In multi-tenant cloud a project admin must not enumerate or delete clients other
 * projects rely on.
 */
const selfHostedAdminProcedure = adminProtectedProcedure.use(async ({ next }) => {
	if (isCloud) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'MCP OAuth client management is only available on self-hosted deployments.',
		});
	}
	return next();
});

/**
 * Admin management of the OAuth clients that external MCP consumers (Claude, Cursor, dust.tt, …)
 * use to connect to this workspace's MCP endpoint. Creation goes through better-auth's own
 * create-client endpoint so secret hashing/storage matches the token flow; the plaintext secret is
 * returned once and never stored or listed afterwards.
 */
export const mcpOAuthClientsRoutes = router({
	list: selfHostedAdminProcedure.query(async () => {
		const rows = await db
			.select({
				clientId: s.oauthClient.clientId,
				name: s.oauthClient.name,
				redirectUris: s.oauthClient.redirectUris,
				isPublic: s.oauthClient.public,
				createdAt: s.oauthClient.createdAt,
			})
			.from(s.oauthClient)
			.where(eq(s.oauthClient.disabled, false))
			.orderBy(desc(s.oauthClient.createdAt))
			.execute();

		return rows.map((row) => ({
			clientId: row.clientId,
			name: row.name ?? null,
			redirectUris: row.redirectUris ?? [],
			isPublic: row.isPublic ?? false,
			createdAt: row.createdAt,
		}));
	}),

	create: selfHostedAdminProcedure
		.input(
			z.object({
				name: z.string().min(1).max(200),
				redirectUris: z.array(z.url()).min(1),
				// Confidential clients get a secret (client_secret_basic) for server-to-server clients
				// like dust.tt Static OAuth; public clients use PKCE only (no secret).
				confidential: z.boolean().default(true),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const token = ctx.session?.session?.token;
			if (!token) {
				throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No active session.' });
			}

			const auth = await getAuth();
			const created = (await auth.api.createOAuthClient({
				body: {
					client_name: input.name,
					redirect_uris: input.redirectUris,
					token_endpoint_auth_method: input.confidential ? 'client_secret_basic' : 'none',
					grant_types: ['authorization_code', 'refresh_token'],
					response_types: ['code'],
				},
				headers: new Headers({ authorization: `Bearer ${token}` }),
			})) as { client_id?: string; client_secret?: string };

			if (!created.client_id) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Client creation returned no client id.',
				});
			}

			// client_secret is present only for confidential clients, and only here — it is never
			// retrievable again.
			return { clientId: created.client_id, clientSecret: created.client_secret ?? null };
		}),

	delete: selfHostedAdminProcedure.input(z.object({ clientId: z.string().min(1) })).mutation(async ({ input }) => {
		await db.delete(s.oauthClient).where(eq(s.oauthClient.clientId, input.clientId)).execute();
		return { clientId: input.clientId };
	}),
});
