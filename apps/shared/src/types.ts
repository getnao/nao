export type UserRole = 'admin' | 'user' | 'viewer';

export const USER_ROLES = ['admin', 'user', 'viewer'] as const satisfies readonly UserRole[];

export type UpdatedAtFilter = { mode: 'single'; value: string } | { mode: 'range'; start: string; end: string };

export const NO_CACHE_SCHEDULE = 'no-cache';

export const LLM_PROVIDERS = [
	'openai',
	'anthropic',
	'google',
	'mistral',
	'openrouter',
	'ollama',
	'bedrock',
	'vertex',
] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export type LlmSelectedModel = {
	provider: LlmProvider;
	modelId: string;
};

export type SummarySegment =
	| { type: 'text'; content: string }
	| { type: 'chart'; chartType: string; title: string }
	| { type: 'table'; title: string }
	| { type: 'grid'; cols: number; children: SummarySegment[] };

export type StorySummary = {
	segments: SummarySegment[];
};

export type FileTreeEntry = {
	name: string;
	path: string;
	type: 'file' | 'directory';
	children?: FileTreeEntry[];
};

export type ProjectChatListItem = {
	id: string;
	updatedAt: number;
	userId: string;
	userName: string;
	userRole: UserRole | null;
	title: string;
	numberOfMessages: number;
	totalTokens: number;
	feedbackText: string;
	downvotes: number;
	upvotes: number;
	toolErrorCount: number;
	toolAvailableCount: number;
};
