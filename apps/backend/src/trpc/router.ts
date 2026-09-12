import { accountRoutes } from './account.routes';
import { analyticsEventRoutes } from './analytics-event.routes';
import { apiKeyRoutes } from './api-key.routes';
import { authConfigRoutes } from './auth-config.routes';
import { automationRoutes } from './automation.routes';
import { brandingRoutes } from './branding.routes';
import { budgetRoutes } from './budget.routes';
import { chartRoutes } from './chart.routes';
import { chartPluginRoutes } from './chart-plugin.routes';
import { chatRoutes } from './chat.routes';
import { chatForkRoutes } from './chat-fork.routes';
import { citationRoutes } from './citation.routes';
import { contextExplorerRoutes } from './context-explorer.routes';
import { contextRecommendationRoutes } from './context-recommendation.routes';
import { embedRoutes } from './embed.routes';
import { favoriteRoutes } from './favorite.routes';
import { feedbackRoutes } from './feedback.routes';
import { githubRoutes } from './github.routes';
import { gitlabRoutes } from './gitlab.routes';
import { licenseRoutes } from './license.routes';
import { logRoutes } from './log.routes';
import { mapRoutes } from './map.routes';
import { mcpRoutes } from './mcp.routes';
import { mcpEndpointRoutes } from './mcp-endpoint.routes';
import { mcpOAuthClientsRoutes } from './mcp-oauth-clients.routes';
import { memoryRoutes } from './memory.routes';
import { organizationRoutes } from './organization.routes';
import { posthogRoutes } from './posthog.routes';
import { projectRoutes } from './project.routes';
import { sharedChatRoutes } from './shared-chat.routes';
import { sharedStoryRoutes } from './shared-story.routes';
import { skillRoutes } from './skill.routes';
import { sqlRoutes } from './sql.routes';
import { storageRoutes } from './storage.routes';
import { storyRoutes } from './story.routes';
import { storyFolderRoutes } from './story-folder.routes';
import { systemRoutes } from './system.routes';
import { transcribeRoutes } from './transcribe.routes';
import { router } from './trpc';
import { usageRoutes } from './usage.routes';
import { userRoutes } from './user.routes';

export const trpcRouter = router({
	analyticsEvent: analyticsEventRoutes,
	branding: brandingRoutes,
	budget: budgetRoutes,
	embed: embedRoutes,
	chart: chartRoutes,
	chartPlugin: chartPluginRoutes,
	chat: chatRoutes,
	map: mapRoutes,
	sql: sqlRoutes,
	sharedChat: sharedChatRoutes,
	automation: automationRoutes,
	chatFork: chatForkRoutes,
	citation: citationRoutes,
	contextExplorer: contextExplorerRoutes,
	contextRecommendation: contextRecommendationRoutes,
	favorite: favoriteRoutes,
	feedback: feedbackRoutes,
	github: githubRoutes,
	gitlab: gitlabRoutes,
	license: licenseRoutes,
	log: logRoutes,
	posthog: posthogRoutes,
	project: projectRoutes,
	storage: storageRoutes,
	storyShare: sharedStoryRoutes,
	story: storyRoutes,
	storyFolder: storyFolderRoutes,
	usage: usageRoutes,
	user: userRoutes,
	memory: memoryRoutes,
	organization: organizationRoutes,
	authConfig: authConfigRoutes,
	account: accountRoutes,
	apiKey: apiKeyRoutes,
	mcp: mcpRoutes,
	mcpEndpoint: mcpEndpointRoutes,
	mcpOAuthClients: mcpOAuthClientsRoutes,
	system: systemRoutes,
	skill: skillRoutes,
	transcribe: transcribeRoutes,
});

export type TrpcRouter = typeof trpcRouter;
