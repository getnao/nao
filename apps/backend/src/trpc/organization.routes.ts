import * as orgQueries from '../queries/organization.queries';
import { protectedProcedure } from './trpc';

export const organizationRoutes = {
	getCurrent: protectedProcedure.query(async ({ ctx }) => {
		const membership = await orgQueries.getUserOrgMembership(ctx.user.id);

		if (!membership) return null;
		return {
			id: membership.organization.id,
			name: membership.organization.name,
			userRole: membership.role,
		};
	}),
};
