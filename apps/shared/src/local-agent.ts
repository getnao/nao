/**
 * The contract between the web UI and the nao desktop app for turns run on the user's own Claude
 * subscription. The web UI comes from the server and the desktop app is installed separately, so
 * either side may be older: fields are only ever added, and `LOCAL_AGENT_PROTOCOL_VERSION` says
 * which ones a desktop app knows.
 */
export const LOCAL_AGENT_PROTOCOL_VERSION = 1;

export type LocalAgentProvider = 'claude';

export type LocalAgentStatus =
	| { state: 'ready'; version: string; account: LocalAgentAccount; models: LocalAgentModel[] }
	| { state: 'not-installed' }
	| { state: 'not-logged-in'; version: string }
	| { state: 'error'; message: string };

export interface LocalAgentAccount {
	email?: string;
	subscriptionType?: string;
}

export interface LocalAgentModel {
	value: string;
	displayName: string;
	description: string;
}

export interface LocalAgentTurnInput {
	provider: LocalAgentProvider;
	model?: string;
	prompt: string;
	/** Earlier messages of the chat as text, replayed to the new Claude session. */
	history: string | null;
	systemPrompt: string;
	/** The nao tools of the chat. The desktop app only accepts a URL on the server it shows. */
	mcp: { url: string; token: string };
}

/** `Chunk` is an AI SDK `UIMessageChunk`, the stream format the chat UI already reads. */
export type LocalAgentTurnEvent<Chunk = unknown> =
	| { type: 'chunk'; chunk: Chunk }
	| {
			type: 'done';
			modelId: string;
			stopReason: LocalAgentStopReason;
			errorMessage?: string;
			usage?: LocalAgentUsage;
	  };

export type LocalAgentStopReason = 'stop' | 'error' | 'interrupted';

export interface LocalAgentUsage {
	inputTokens?: number;
	cacheReadInputTokens?: number;
	cacheCreationInputTokens?: number;
	outputTokens?: number;
}

/** What the subscription settings page shows: the plan's limits and what this server's turns used. */
export interface LocalAgentOverview {
	rateLimits: LocalAgentRateLimits;
	usage: LocalAgentUsageSummary;
}

export type LocalAgentRateLimits =
	| { state: 'available'; windows: LocalAgentRateLimitWindow[]; extraUsage: LocalAgentExtraUsage | null }
	| { state: 'unavailable' }
	| { state: 'error'; message: string };

export interface LocalAgentRateLimitWindow {
	label: string;
	/** Percentage of the window used, 0 to 100. */
	utilization: number | null;
	resetsAt: string | null;
}

export interface LocalAgentExtraUsage {
	monthlyLimit: number | null;
	usedCredits: number | null;
	utilization: number | null;
	currency: string | null;
}

/** Read from a file on the user's computer, which only records the turns run through nao. */
export interface LocalAgentUsageSummary {
	periodDays: number;
	totals: LocalAgentUsageTotals;
	byModel: (LocalAgentUsageTotals & { modelId: string })[];
	byDay: (LocalAgentUsageTotals & { day: string })[];
	recentTurns: LocalAgentTurnUsage[];
}

export interface LocalAgentUsageTotals {
	turns: number;
	inputTokens: number;
	outputTokens: number;
	/** What the same tokens would cost on the API, as Claude Code estimates it; not what the plan bills. */
	estimatedCostUsd: number;
}

export interface LocalAgentTurnUsage {
	at: string;
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	estimatedCostUsd: number;
	durationMs: number;
	stopReason: LocalAgentStopReason;
}

/** Where a nao tool result carries its full output, beside the text the model reads. */
export const LOCAL_AGENT_OUTPUT_META_KEY = 'nao/output';

/** The prefix Claude gives the tools of the `nao` MCP server. */
export const LOCAL_AGENT_TOOL_PREFIX = 'mcp__nao__';
