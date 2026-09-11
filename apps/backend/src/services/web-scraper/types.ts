import type { WebRobotRecipe, WebRobotRunStats } from '@nao/shared/web-robot';

export type WebRobotStageRecord = {
	stageId: string;
	url?: string;
	data: Record<string, unknown>;
};

export type WebRobotCapturedResponse = {
	name: string;
	url: string;
	status: number;
	requestMethod?: string;
	requestContentType?: string;
	requestBody?: unknown;
	contentType?: string;
	body: unknown;
};

export type WebRobotLoadedSource = {
	url: string;
	finalUrl: string;
	status: number;
	contentType?: string;
	bodyText?: string;
	bodyJson?: unknown;
	captures: WebRobotCapturedResponse[];
	requests: number;
};

export type WebRobotBlockerKind =
	| 'access_denied'
	| 'bot_challenge'
	| 'captcha'
	| 'consent'
	| 'empty_shell'
	| 'login'
	| 'rate_limited'
	| 'site_error';

export type WebRobotSourceBlocker = {
	kind: WebRobotBlockerKind;
	loader: 'http' | 'browser';
	message: string;
	status?: number;
	evidence?: string;
};

export type WebRobotRunWarning = {
	kind:
		| 'blocker_detected'
		| 'selector_fallback'
		| 'field_coverage_drop'
		| 'pagination_fallback'
		| 'pagination_stopped';
	message: string;
	blocker?: WebRobotBlockerKind;
	selector?: string;
	fallback?: string;
	field?: string;
	relocated?: boolean;
	data?: Record<string, unknown>;
};

export type WebRobotRunEvent = {
	type: 'page' | 'error' | 'item' | 'warning';
	stageId?: string;
	url?: string;
	status?: number;
	message?: string;
	data?: unknown;
	createdAt: string;
};

export type WebRobotExecutionOptions = {
	recipe: WebRobotRecipe;
	runId?: string;
	env?: Record<string, string>;
	dryRun?: boolean;
	signal?: AbortSignal;
	onEvent?: (event: WebRobotRunEvent) => void | Promise<void>;
};

export type WebRobotExecutionResult = {
	stats: WebRobotRunStats;
	stageRecords: Map<string, WebRobotStageRecord[]>;
	products: Record<string, unknown>[];
	events: WebRobotRunEvent[];
};

export type HeaderValues = Record<string, string>;
