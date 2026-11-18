import type { Provider } from '../../types/messaging-provider';
import { analyticsToolsExcluding } from './analytics';
import type { AgentProfile } from './types';

type MessagingProvider = Exclude<Provider, 'automation'>;

const EXCLUDED_TOOLS: Partial<Record<MessagingProvider, string[]>> = {
	slack: ['str_replace'],
};

/** The analytics agent answering in a chat app, where only the built-in charts render. */
export function messagingAgent(provider: MessagingProvider): AgentProfile {
	return {
		source: provider,
		tools: analyticsToolsExcluding(EXCLUDED_TOOLS[provider] ?? []),
		messagingProvider: provider,
		supportsCustomCharts: false,
	};
}
