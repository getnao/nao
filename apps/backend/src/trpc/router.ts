import { accountRoutes } from './account.routes';
import { chatRoutes } from './chat.routes';
import { feedbackRoutes } from './feedback.routes';
import { googleRoutes } from './google.routes';
import { mcpRoutes } from './mcp.routes';
import { posthogRoutes } from './posthog.routes';
import { projectRoutes } from './project.routes';
import { skillRoutes } from './skill.routes';
import { systemRoutes } from './system.routes';
import { transcribeRoutes } from './transcribe.routes';
import { router } from './trpc';
import { usageRoutes } from './usage.routes';
import { userRoutes } from './user.routes';

export const trpcRouter = router({
	chat: chatRoutes,
	feedback: feedbackRoutes,
	posthog: posthogRoutes,
	project: projectRoutes,
	usage: usageRoutes,
	user: userRoutes,
	google: googleRoutes,
	account: accountRoutes,
	mcp: mcpRoutes,
	system: systemRoutes,
	skill: skillRoutes,
	transcribe: transcribeRoutes,
});

export type TrpcRouter = typeof trpcRouter;
