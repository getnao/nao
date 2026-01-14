import { chatRoutes } from './chatRoutes';
import { publicProcedure, router } from './trpc';

export const trpcRouter = router({
	chat: chatRoutes,
	hasGoogleSetup: publicProcedure.query(() => {
		return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
	}),
});

export type TrpcRouter = typeof trpcRouter;
