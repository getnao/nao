import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import superjson from 'superjson';

import { auth } from '../auth';
import { convertHeaders } from '../utils/utils';

export type Context = Awaited<ReturnType<typeof createContext>>;
export type MiddlewareFunction = Parameters<typeof t.procedure.use>[0];

export const createContext = async (opts: CreateFastifyContextOptions) => {
	const headers = convertHeaders(opts.req.headers);
	const session = await auth.api.getSession({ headers });
	return {
		session,
	};
};

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create({
	transformer: superjson,
});

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
	if (!ctx.session?.user) {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}
	return next({ ctx: { user: ctx.session.user } });
});
