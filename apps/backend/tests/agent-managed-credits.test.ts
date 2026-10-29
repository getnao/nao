import { afterEach, expect, it, vi } from 'vitest';

import { analyticsAgent } from '../src/agents/profiles/analytics';
import { handleAgentRoute } from '../src/handlers/agent';
import * as chatQueries from '../src/queries/chat.queries';
import { agentService } from '../src/services/agent';
import { ManagedCreditsExhaustedError } from '../src/utils/error';

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
