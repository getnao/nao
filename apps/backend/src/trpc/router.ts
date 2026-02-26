import { accountRoutes } from './account.routes';
import { chartRoutes } from './chart.routes';
import { chatRoutes } from './chat.routes';
import { feedbackRoutes } from './feedback.routes';
import { googleRoutes } from './google.routes';
import { mcpRoutes } from './mcp.routes';
import { memoryRoutes } from './memory.routes';
import { posthogRoutes } from './posthog.routes';
import { projectRoutes } from './project.routes';
import { sharedStoryRoutes } from './shared-story.routes';
import { skillRoutes } from './skill.routes';
import { storyRoutes } from './story.routes';
import { systemRoutes } from './system.routes';
import { transcribeRoutes } from './transcribe.routes';
import { router } from './trpc';
import { usageRoutes } from './usage.routes';
import { userRoutes } from './user.routes';

export const trpcRouter = router({
	chart: chartRoutes,
	chat: chatRoutes,
	feedback: feedbackRoutes,
	posthog: posthogRoutes,
	project: projectRoutes,
	storyShare: sharedStoryRoutes,
	story: storyRoutes,
	usage: usageRoutes,
	user: userRoutes,
	memory: memoryRoutes,
	google: googleRoutes,
	account: accountRoutes,
	mcp: mcpRoutes,
	system: systemRoutes,
	skill: skillRoutes,
	transcribe: transcribeRoutes,
});

export type TrpcRouter = typeof trpcRouter;
