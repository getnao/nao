import { chatRoutes } from './chat.routes';
import { feedbackRoutes } from './feedback.routes';
import { publicProcedure, router } from './trpc';
import { userRoutes } from './user.routes';

export const trpcRouter = router({
	chat: chatRoutes,
	feedback: feedbackRoutes,
	user: userRoutes,
	hasGoogleSetup: publicProcedure.query(() => {
		return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
	}),
	getModelProvider: publicProcedure.query(() => {
		return process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : undefined;
	}),
});

export type TrpcRouter = typeof trpcRouter;
