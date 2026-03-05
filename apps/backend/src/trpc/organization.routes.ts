import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as organizationQueries from '../queries/organization.queries';
import { projectProtectedProcedure } from './trpc';

export const organizationRoutes = {
	getOrgChats: projectProtectedProcedure
		.input(
			z
				.object({
					chatLimit: z.number().int().min(1).max(30).optional(),
					perUserChatLimit: z.number().int().min(1).max(30).optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const orgId = ctx.project.orgId ?? (await organizationQueries.getFirstOrganization())?.id;
			if (!orgId) {
				return { chats: [] };
			}

			const membership = await organizationQueries.getOrgMember(orgId, ctx.user.id);
			if (!membership) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of this organization.' });
			}
			if (membership.role !== 'admin') {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only organization admins can access user lists.' });
			}

			return organizationQueries.listOrgChats(orgId, input);
		}),
};
