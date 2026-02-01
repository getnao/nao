import { accountRoutes } from './account.routes';
import { chatRoutes } from './chat.routes';
import { configRoutes } from './config.routes';
import { feedbackRoutes } from './feedback.routes';
import { googleRoutes } from './google.routes';
import { projectRoutes } from './project.routes';
import { router } from './trpc';
import { userRoutes } from './user.routes';

export const trpcRouter = router({
	config: configRoutes,
	chat: chatRoutes,
	feedback: feedbackRoutes,
	project: projectRoutes,
	user: userRoutes,
	google: googleRoutes,
	account: accountRoutes,
});

export type TrpcRouter = typeof trpcRouter;
