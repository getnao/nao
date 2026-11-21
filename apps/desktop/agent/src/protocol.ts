import type {
	LocalAgentOverview,
	LocalAgentStatus,
	LocalAgentTurnEvent,
	LocalAgentTurnInput,
} from '@nao/shared/local-agent';
import type { UIMessageChunk } from 'ai';

/** One JSON line the desktop app writes to the sidecar's stdin. */
export type SidecarRequest =
	| { type: 'status'; requestId: string; refresh?: boolean }
	| { type: 'overview'; requestId: string; serverOrigin: string }
	| { type: 'turn'; turnId: string; turn: LocalAgentTurnInput }
	| { type: 'stop'; turnId: string };

/** One JSON line the sidecar writes to its stdout. */
export type SidecarMessage =
	| { type: 'status'; requestId: string; status: LocalAgentStatus }
	| { type: 'overview'; requestId: string; overview: LocalAgentOverview }
	| { type: 'turn-event'; turnId: string; event: TurnEvent };

export type TurnEvent = LocalAgentTurnEvent<UIMessageChunk>;
