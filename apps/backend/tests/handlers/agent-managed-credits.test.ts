import { afterEach, expect, it, vi } from 'vitest';

import { analyticsAgent } from '../../src/agents/profiles/analytics';
import { handleAgentRoute } from '../../src/handlers/agent';
import * as chatQueries from '../../src/queries/chat.queries';
import { agentService } from '../../src/services/agent';
import * as githubStarPrompt from '../../src/services/github-star-prompt.service';
import { mcpService } from '../../src/services/mcp';
import type { UIChat } from '../../src/types/chat';
import { ManagedCreditsExhaustedError } from '../../src/utils/error';

afterEach(() => {
	vi.restoreAllMocks();
});

it('rejects exhausted managed credits before persisting the user message', async () => {
	const error = new ManagedCreditsExhaustedError(1);
	vi.spyOn(agentService, 'assertRunAvailable').mockRejectedValue(error);
	const createChat = vi.spyOn(chatQueries, 'createChat');

	await expect(
		handleAgentRoute({
			userId: 'user-id',
			projectId: 'project-id',
			message: { text: 'This must not be persisted' },
			model: { provider: 'nao', modelId: 'gpt-6-luna' },
			profile: analyticsAgent,
			domainHost: undefined,
		}),
	).rejects.toBe(error);

	expect(createChat).not.toHaveBeenCalled();
});

it('reports the saved question before setting the agent up, so its run can be followed meanwhile', async () => {
	const setupError = new Error('MCP servers are unreachable');
	vi.spyOn(agentService, 'assertRunAvailable').mockResolvedValue({ provider: 'nao', modelId: 'gpt-6-luna' });
	vi.spyOn(chatQueries, 'createChat').mockResolvedValue([{ id: 'saved-chat' }, { id: 'saved-message' }] as Awaited<
		ReturnType<typeof chatQueries.createChat>
	>);
	vi.spyOn(chatQueries, 'getChat').mockResolvedValue([{ id: 'saved-chat' } as UIChat, 'user-id']);
	vi.spyOn(githubStarPrompt, 'recordWebConversationStarted').mockResolvedValue();
	vi.spyOn(mcpService, 'initializeMcpState').mockRejectedValue(setupError);
	const onUserMessageSaved = vi.fn();

	await expect(
		handleAgentRoute({
			userId: 'user-id',
			projectId: 'project-id',
			message: { text: 'How did revenue do?' },
			model: { provider: 'nao', modelId: 'gpt-6-luna' },
			profile: analyticsAgent,
			domainHost: undefined,
			onUserMessageSaved,
		}),
	).rejects.toBe(setupError);

	expect(onUserMessageSaved).toHaveBeenCalledWith('saved-chat');
});
