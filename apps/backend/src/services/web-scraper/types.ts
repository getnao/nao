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

export type WebRobotRunEvent = {
	type: 'page' | 'error' | 'item';
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
