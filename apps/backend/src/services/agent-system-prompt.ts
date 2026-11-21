import { isSkillGranted } from '@nao/shared';

import type { AgentProfile } from '../agents/profiles/types';
import { getSystemPromptOverride, hasNaoPromptPlaceholder, injectNaoPrompt } from '../agents/system-prompts';
import { getConnections, getUserRules } from '../agents/user-rules';
import { ChatForkContextPrompt, MessagingProviderSystemPrompt, SystemPrompt } from '../components/ai';
import { renderToMarkdown } from '../lib/markdown';
import * as projectQueries from '../queries/project.queries';
import { Provider } from '../types/messaging-provider';
import { ToolContext } from '../types/tools';
import { extractConfiguredDatabases, readProjectContext } from '../utils/nao-config';
import type { AgentChat } from './agent';
import { listChartPlugins } from './chart-plugin';
import { mcpService } from './mcp';
import { memoryService } from './memory';
import { sandboxSecretService } from './sandbox-secret.service';
import { skillService } from './skill';
import { isStorageEnabled } from './storage';
import { canGrepUserFiles } from './storage/user-files';
import { customStoryAuthoringError } from './story-mount';
import { resolveStoryOriginConversationSafely } from './story-origin';
import { listTrustedStoriesForPrompt } from './story-reference';
import { type AgentUserGroupAccess, appendAgentUserGroupRestrictions } from './user-group-feature-access.service';

export interface AgentSystemPromptInput {
	chat: AgentChat;
	profile: AgentProfile;
	toolContext: ToolContext;
	toolNames: string[];
	userGroupAccess: AgentUserGroupAccess;
	timezone?: string;
	chatUrl?: string;
}

/** The system prompt of a run: the profile's own prompt, or the project prompt built from its context. */
export async function buildAgentSystemPrompt(input: AgentSystemPromptInput): Promise<string> {
	const selectedSystemPrompt =
		(await input.profile.systemPrompt?.({ timezone: input.timezone, chat: input.chat })) ??
		(await buildProjectSystemPrompt(input));
	return appendAgentUserGroupRestrictions(selectedSystemPrompt, input.userGroupAccess);
}

async function buildProjectSystemPrompt(input: AgentSystemPromptInput): Promise<string> {
	const { profile, toolContext } = input;
	const provider = profile.messagingProvider;
	const override = getSystemPromptOverride(toolContext.projectFolder, provider);
	let systemPrompt: string;
	if (override && !hasNaoPromptPlaceholder(override)) {
		systemPrompt = override;
	} else {
		const defaultPrompt = await buildDefaultSystemPrompt(input, provider);
		systemPrompt = override ? injectNaoPrompt(override, defaultPrompt) : defaultPrompt;
	}

	return profile.promptAppendix ? `${systemPrompt}\n\n${profile.promptAppendix}` : systemPrompt;
}

async function buildDefaultSystemPrompt(input: AgentSystemPromptInput, provider?: Provider): Promise<string> {
	const { chat, profile, toolContext, toolNames, timezone, chatUrl } = input;
	const memories = profile.excludesMemories
		? []
		: await memoryService.safeGetUserMemories(chat.userId, chat.projectId, chat.id);
	const userRules = profile.excludesUserRules
		? undefined
		: getUserRules(toolContext.projectFolder, toolContext.userRulesGroupAccess);
	const connections = getConnections(toolContext.projectFolder);
	const configuredDatabases = extractConfiguredDatabases(toolContext.projectFolder);
	const { repos, templates, presence: contextPresence } = readProjectContext(toolContext.projectFolder);
	const repoNames = repos.map((repo) => repo.name);
	const skills = skillService
		.getSkills(chat.projectId)
		.filter((skill) => isSkillGranted(toolContext.skillsAccess, skill.name));
	const preloadedSkills = skillService.getPreloadedSkills(chat.projectId, toolContext.preloadedSkillNames);
	const customCharts = toolContext.supportsCustomCharts ? listChartPlugins(toolContext.projectFolder) : [];
	const [mcpServers, sandboxSecrets, trustedStories, mapBoundaries] = await Promise.all([
		mcpService.getEnabledServers(chat.projectId, toolContext.mcpAccess),
		toolNames.includes('execute_sandboxed_code')
			? sandboxSecretService.safeListDefinitions(chat.userId, chat.projectId)
			: Promise.resolve([]),
		toolNames.includes('list') && toolNames.includes('read')
			? listTrustedStoriesForPrompt({ userId: chat.userId, projectId: chat.projectId })
			: Promise.resolve([]),
		projectQueries.getCustomBoundaries(chat.projectId),
	]);
	const basePrompt = renderToMarkdown(
		SystemPrompt({
			memories,
			userRules,
			connections,
			configuredDatabases,
			skills,
			preloadedSkills,
			customCharts,
			mapBoundaries,
			mcpServers,
			sandboxSecrets,
			trustedStories,
			semanticLayerMode: toolContext.semanticLayerMode,
			templates,
			repoNames,
			contextPresence,
			timezone,
			role: profile.role,
			toolNames,
			options: {
				savedFilesEnabled: isStorageEnabled(),
				canGrepSavedFiles: canGrepUserFiles(),
				customStoriesEnabled: customStoryAuthoringError(toolContext.userGroupFeatures) === null,
			},
		}),
	);
	const renderedPrompt = provider
		? renderToMarkdown(MessagingProviderSystemPrompt({ basePrompt, provider, chatUrl }))
		: basePrompt;
	return chat.forkMetadata
		? renderToMarkdown(
				ChatForkContextPrompt({
					basePrompt: renderedPrompt,
					forkMetadata: chat.forkMetadata,
					linkedStory: toolContext.linkedStory,
					storyOriginConversation: await resolveStoryOriginConversationSafely(chat),
				}),
			)
		: renderedPrompt;
}
