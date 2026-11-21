import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type {
	LocalAgentModel,
	LocalAgentOverview,
	LocalAgentProvider,
	LocalAgentStatus,
	LocalAgentTurnEvent,
	LocalAgentTurnInput,
} from '@nao/shared/local-agent';
import type { UIMessageChunk } from 'ai';

/** A model of the user's own subscription, run by the nao desktop app instead of the server. */
export interface LocalAgentSelection {
	provider: LocalAgentProvider;
	model: string;
	displayName: string;
}

export type LocalAgentEvent = LocalAgentTurnEvent<UIMessageChunk>;

/** Model aliases such as `opus` follow the latest release; the dated ids are left out of the picker. */
const PINNED_MODEL_PREFIX = 'claude-';

export function isDesktopApp(): boolean {
	return isTauri();
}

export function getLocalAgentStatus(refresh = false): Promise<LocalAgentStatus> {
	return invoke<LocalAgentStatus>('local_agent_status', { refresh });
}

/** The plan limits and the usage of this server's turns; reading the limits starts Claude Code once. */
export function getLocalAgentOverview(): Promise<LocalAgentOverview> {
	return invoke<LocalAgentOverview>('local_agent_overview');
}

export async function startLocalAgentTurn(
	turn: LocalAgentTurnInput,
	onEvent: (event: LocalAgentEvent) => void,
): Promise<string> {
	const channel = new Channel<LocalAgentEvent>();
	channel.onmessage = onEvent;
	return invoke<string>('local_agent_start_turn', { turn, onEvent: channel });
}

export function stopLocalAgentTurn(turnId: string): Promise<void> {
	return invoke('local_agent_stop_turn', { turnId });
}

export function listPickableModels(status: LocalAgentStatus | undefined): LocalAgentModel[] {
	if (status?.state !== 'ready') {
		return [];
	}
	return status.models.filter((model) => !model.value.startsWith(PINNED_MODEL_PREFIX));
}
