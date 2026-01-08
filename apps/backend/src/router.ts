import { z } from 'zod';

import { db } from './db/db';
import { publicProcedure, router } from './trpc';
import { isPostgres } from './utils';

export const trpcRouter = router({
	test: publicProcedure.query(() => {
		return { hello: 'world' };
	}),

	dbTest: publicProcedure
		.input(
			z.object({
				query: z.string(),
			}),
		)
		.query(({ input }) => {
			// @ts-expect-error - db type is determined by isPostgres at runtime
			return isPostgres ? db.execute(input.query) : db.run(input.query);
		}),

	hasGoogleSetup: publicProcedure.query(() => {
		return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
	}),
});

export type TrpcRouter = typeof trpcRouter;
