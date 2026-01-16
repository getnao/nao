import { z } from 'zod/v4';

import * as userQueries from '../queries/user.queries';
import { protectedProcedure } from './trpc';

export const userRoutes = {
	modifyUser: protectedProcedure
		.input(z.object({ userID: z.string(), name: z.string().optional() }))
		.mutation(({ input }) => {
			return userQueries.modifyUser(input.userID, { name: input.name });
		}),
};
