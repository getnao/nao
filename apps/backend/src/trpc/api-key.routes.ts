import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as apiKeyQueries from '../queries/api-key.queries';
import * as orgQueries from '../queries/organization.queries';
import { generateApiKey } from '../services/api-key.service';
import { protectedProcedure } from './trpc';

const orgAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const membership = await orgQueries.getUserOrgMembership(ctx.user.id);
	if (!membership) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'You are not a member of any organization' });
	}
	if (membership.role !== 'admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only organization admins can manage API keys' });
	}
	return next({ ctx: { org: membership.organization } });
});

export const apiKeyRoutes = {
	create: orgAdminProcedure.input(z.object({ name: z.string().min(1).max(100) })).mutation(async ({ input, ctx }) => {
		const { plaintext, hash, prefix } = generateApiKey();
		const apiKey = await apiKeyQueries.createApiKey({
			orgId: ctx.org.id,
			name: input.name,
			keyHash: hash,
			keyPrefix: prefix,
			createdBy: ctx.user.id,
		});
		return { id: apiKey.id, plaintext, prefix };
	}),

	list: orgAdminProcedure.query(async ({ ctx }) => {
		const keys = await apiKeyQueries.listApiKeysByOrg(ctx.org.id);
		return keys.map((k) => ({
			id: k.id,
			name: k.name,
			keyPrefix: k.keyPrefix,
			createdBy: k.createdBy,
			lastUsedAt: k.lastUsedAt?.getTime() ?? null,
			createdAt: k.createdAt.getTime(),
		}));
	}),

	revoke: orgAdminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const keys = await apiKeyQueries.listApiKeysByOrg(ctx.org.id);
		const key = keys.find((k) => k.id === input.id);
		if (!key) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found' });
		}
		await apiKeyQueries.deleteApiKey(input.id);
	}),
};
