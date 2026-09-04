import type { DocumentExtension } from './attachments';

export type UserRole = 'admin' | 'user' | 'viewer' | 'context_admin';

export const USER_ROLES = ['admin', 'user', 'viewer', 'context_admin'] as const satisfies readonly UserRole[];

/** Project roles available when editing organization members (org roles never include context_admin). */
export const ORG_MEMBER_ROLES = ['admin', 'user', 'viewer'] as const satisfies readonly UserRole[];

/** `invited` until the user replaces their temporary password on first sign-in. */
export type MemberStatus = 'invited' | 'active';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
	admin: 'Admin',
	user: 'User',
	viewer: 'Viewer',
	context_admin: 'Context Admin',
};

export const TOOL_CALL_DENSITIES = ['compact', 'detailed'] as const;

/** How much detail to show for tool calls in the chat. */
export type ToolCallDensity = (typeof TOOL_CALL_DENSITIES)[number];

export const DEFAULT_PYTHON_EXECUTION_DURATION_SECS = 30;
export const MIN_PYTHON_EXECUTION_DURATION_SECS = 1;
export const MAX_PYTHON_EXECUTION_DURATION_SECS = 600;

export interface UserPreferences {
	toolCallDensity?: ToolCallDensity;
}

export type UpdatedAtFilter = { mode: 'single'; value: string } | { mode: 'range'; start: string; end: string };

export const CHAT_REPLAY_TOOL_STATES = ['noToolsUsed', 'toolsNoErrors', 'toolsWithErrors'] as const;
export type ChatReplayToolState = (typeof CHAT_REPLAY_TOOL_STATES)[number];

export const CHAT_REPLAY_FEEDBACK_STATES = ['noVotes', 'upvotes', 'downvotes'] as const;
export type ChatReplayFeedbackState = (typeof CHAT_REPLAY_FEEDBACK_STATES)[number];

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
	'qwen',
	'minimax',
	'moonshot',
	'openaiCompatible',
] as const;

export const providerLabels: Record<LlmProviderKind, string> = {
	openai: 'OpenAI',
	anthropic: 'Anthropic',
	google: 'Google',
	mistral: 'Mistral',
	openrouter: 'OpenRouter',
	ollama: 'Ollama',
	bedrock: 'Amazon Bedrock',
	vertex: 'Vertex AI',
	azure: 'Azure Foundry',
	qwen: 'Qwen',
	minimax: 'MiniMax',
	moonshot: 'Moonshot',
	openaiCompatible: 'OpenAI Compatible',
};

/** One of nao's built-in provider integrations. */
export type LlmProviderKind = (typeof LLM_PROVIDERS)[number];

/** The only kind a project can declare several times, each instance under a name of its own. */
export const NAMED_PROVIDER_KIND = 'openaiCompatible';
const NAMED_PROVIDER_SEPARATOR = '/';
const PROVIDER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** An instance of the named kind, as an admin declared it, e.g. `openaiCompatible/my-vllm`. */
export type NamedLlmProvider = `${typeof NAMED_PROVIDER_KIND}/${string}`;

/**
 * How a project addresses a provider, and how every model, message and budget refers to it: either
 * a built-in kind, or a named instance of the kind that allows them.
 */
export type LlmProvider = LlmProviderKind | NamedLlmProvider;

/** The built-in integration backing a provider, which is the provider itself unless it is named. */
export function providerKind(provider: LlmProvider): LlmProviderKind {
	return provider.split(NAMED_PROVIDER_SEPARATOR)[0] as LlmProviderKind;
}

/** The name given to a provider instance, or null when the provider is a built-in kind. */
export function providerName(provider: LlmProvider): string | null {
	const separator = provider.indexOf(NAMED_PROVIDER_SEPARATOR);
	return separator === -1 ? null : provider.slice(separator + 1);
}

/** What to call a provider on screen: the name its admin gave it, or the name of its integration. */
export function providerLabel(provider: LlmProvider): string {
	return providerName(provider) ?? providerLabels[providerKind(provider)];
}

/** Turn what an admin typed into a provider name, or null when nothing usable is left of it. */
export function toProviderName(input: string): string | null {
	const name = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return PROVIDER_NAME_PATTERN.test(name) ? name : null;
}

export function toNamedProvider(name: string): LlmProvider {
	return `${NAMED_PROVIDER_KIND}${NAMED_PROVIDER_SEPARATOR}${name}`;
}

export function isLlmProvider(value: string): value is LlmProvider {
	const [kind, ...rest] = value.split(NAMED_PROVIDER_SEPARATOR);
	if (!(LLM_PROVIDERS as readonly string[]).includes(kind)) {
		return false;
	}
	if (rest.length === 0) {
		return true;
	}
	return kind === NAMED_PROVIDER_KIND && rest.length === 1 && PROVIDER_NAME_PATTERN.test(rest[0]);
}

export type LlmSelectedModel = {
	provider: LlmProvider;
	modelId: string;
};

export type SummarySegment =
	| { type: 'text'; content: string }
	| { type: 'chart'; chartType: string; title: string; kpiCount?: number }
	| { type: 'table'; title: string }
	| { type: 'map'; mapType: string; title: string }
	| { type: 'grid'; cols: number; widths: number[] | null; children: SummarySegment[] };

export type StorySummary = {
	segments: SummarySegment[];
};

export type FileTreeEntry = {
	name: string;
	path: string;
	type: 'file' | 'directory';
	children?: FileTreeEntry[];
};

export type ContextGitUnavailableReason =
	| 'github-unavailable'
	| 'git-unavailable'
	| 'no-token'
	| 'no-repo'
	| 'unsupported-provider'
	| 'project-not-found'
	| 'project-ambiguous';

export type FileEditabilityReason =
	| ContextGitUnavailableReason
	| 'generated'
	| 'rendered-template'
	| 'synced-source'
	| 'not-tracked';

export type FileEditabilityGuidance =
	| {
			message: string;
			actionKind: 'file' | 'route';
			actionPath: string;
			actionLabel: string;
	  }
	| {
			message: string;
			actionKind: null;
			actionPath: null;
			actionLabel: null;
	  };

export type FileContentResponse = {
	content: string;
	hash: string;
	isEditable: boolean;
	reason: FileEditabilityReason | null;
	guidance?: FileEditabilityGuidance;
};

export type FileWriteResponse = {
	hash: string;
};

export type FileContentSearchResult = {
	path: string;
	count: number;
	line: number;
	text: string;
};

export type FileContentSearchResponse = {
	results: FileContentSearchResult[];
	truncated: boolean;
};

export type ContextChangedFile = {
	path: string;
	kind: 'modified' | 'untracked' | 'deleted';
	additions: number | null;
	deletions: number | null;
};

export type ContextBranchInfo = {
	currentBranch: string | null;
	defaultBranch: string;
	aheadCommitCount: number;
	unpushedCommitCount: number;
	branches: string[];
	suggestedBranch: string;
};

export type ContextBranchCreationResult = ContextBranchInfo & {
	usedFallbackBase: boolean;
};

export type ContextFileDiff = ContextChangedFile & {
	oldContent: string;
	newContent: string;
};

export const WARNING_BUDGET_THRESHOLD = 0.8;
export const MAX_BUDGET_LIMIT_USD = 200_000;

export const BUDGET_PERIODS = ['day', 'week', 'month'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const SHARE_VISIBILITY = ['project', 'specific'] as const;
export type Visibility = (typeof SHARE_VISIBILITY)[number];

export type StorySharingInfo = {
	visibility: Visibility;
	sharedWithCount: number;
	isPinned: boolean;
};

export const FOLDER_VISIBILITY = ['private', 'public'] as const;
export type FolderVisibility = (typeof FOLDER_VISIBILITY)[number];

export const FOLDER_SYSTEM_TYPE = ['private_folder', 'shared_with_me'] as const;
export type FolderSystemType = (typeof FOLDER_SYSTEM_TYPE)[number];

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
	source: string | null;
	numberOfMessages: number;
	totalTokens: number;
	cacheReadTokens: number;
	totalCost: number;
	feedbackText: string;
	downvotes: number;
	upvotes: number;
	toolErrorCount: number;
	toolAvailableCount: number;
};

export type DownloadFormat = 'pdf' | 'html';
export const DOWNLOAD_FORMATS = ['pdf', 'html'] as const satisfies readonly DownloadFormat[];

export type ChatDownloadFormat = 'png' | 'csv' | 'xlsx' | 'other';
export const CHAT_DOWNLOAD_FORMATS = ['png', 'csv', 'xlsx', 'other'] as const satisfies readonly ChatDownloadFormat[];

/** A file taken out of permanent storage is recorded under its own extension. */
export type AnalyticsDownloadFormat = DownloadFormat | ChatDownloadFormat | DocumentExtension;

export const ANALYTICS_EVENT_TYPES = ['page_view', 'download', 'fork', 'favorite', 'refresh', 'view_duration'] as const;
export const ANALYTICS_ASSET_TYPES = ['chat', 'story'] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];
export type AnalyticsAssetType = (typeof ANALYTICS_ASSET_TYPES)[number];

export type AnalyticsEventMetadata =
	| { type: 'page_view'; versionNumber?: number }
	| { type: 'download'; format: AnalyticsDownloadFormat; queryId?: string; versionNumber?: number; title?: string }
	| { type: 'fork'; resultId: string; scope: 'full' | 'selection'; versionNumber?: number }
	| { type: 'favorite'; favorited: boolean }
	| { type: 'refresh'; trigger: 'manual' | 'scheduled'; queriesRefreshed?: number }
	| { type: 'view_duration'; durationMs: number; startedAt: number; versionNumber?: number };

export interface CitationData {
	start: number;
	end: number;
	text: string;
	storySlug?: string;
}

export type MessageBubble = { role: 'user' | 'assistant'; charCount: number };

export const CHAT_GROUP_BY_OPTIONS = ['star', 'date', 'project', 'ownership', 'sourcePlatform', 'none'] as const;
export const CHAT_FILTER_OPTIONS = ['all', 'mine', 'starred', 'shared', 'shared_with_me'] as const;

export type ChatGroupBy = (typeof CHAT_GROUP_BY_OPTIONS)[number];
export type ChatFilterType = (typeof CHAT_FILTER_OPTIONS)[number];

export interface GroupedChatItem {
	id: string;
	projectId: string;
	title: string;
	isStarred: boolean;
	createdAt: number;
	updatedAt: number;
	kind: 'own' | 'shared';
	shareId?: string;
	ownerName: string;
}

export interface ChatGroup {
	label: string | null;
	chats: GroupedChatItem[];
}

export interface GroupedChatListResponse {
	groups: ChatGroup[];
}

export const MCP_EMBED_KINDS = ['story', 'chart', 'map'] as const satisfies readonly string[];

export type McpEmbedKind = (typeof MCP_EMBED_KINDS)[number];

export const MCP_EMBED_SANDBOX_HTML_FIELD = {
	story: 'sandboxStoryHtml',
	chart: 'sandboxChartHtml',
	map: 'sandboxMapHtml',
} as const satisfies Record<McpEmbedKind, string>;

export type EmbedTokenPayload = {
	type: McpEmbedKind;
	resourceId: string;
	projectId: string;
	exp: number;
};

export type StoryPanelDisplayMode = 'grid' | 'lines';

export const REPO_PROVIDERS = ['github', 'gitlab'] as const;
export const BULK_ITEMS_LIMIT = 100;

export type RepoProvider = (typeof REPO_PROVIDERS)[number];
export type BulkStoryItem = { kind: 'own'; storyId: string } | { kind: 'shared-project'; storyId: string };
