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
	'azure',
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

export const ALLOWED_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type ImageMediaType = (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number];

export type ImageUploadData = {
	mediaType: ImageMediaType;
	data: string;
};

export const SHARE_VISIBILITY = ['project', 'specific'] as const;
export type Visibility = (typeof SHARE_VISIBILITY)[number];

export type ProjectChatReplayFacets<R extends string = string> = {
	userNames: string[];
	userNameCounts: Record<string, number>;
	userRoles: (R | 'Former member')[];
	userRoleCounts: Partial<Record<R | 'Former member', number>>;
	toolState: {
		noToolsUsed: number;
		toolsNoErrors: number;
		toolsWithErrors: number;
	};
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

export type DownloadFormat = 'pdf' | 'html';

export const DOWNLOAD_FORMATS = ['pdf', 'html'] as const satisfies readonly DownloadFormat[];
