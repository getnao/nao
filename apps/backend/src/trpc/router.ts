import { chatRoutes } from './chat.routes';
import { feedbackRoutes } from './feedback.routes';
import { publicProcedure, router } from './trpc';

export const trpcRouter = router({
	chat: chatRoutes,
	feedback: feedbackRoutes,
	hasGoogleSetup: publicProcedure.query(() => {
		return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
	}),
});

export type TrpcRouter = typeof trpcRouter;
