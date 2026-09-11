import { webRobotBrowserActionSchema, webRobotBrowserCaptureSchema, webRobotRecipeSchema } from '@nao/shared/web-robot';
import { z } from 'zod/v4';

import type { TrpcRouter } from '@nao/backend/trpc';
import type { WebRobotBrowserAction, WebRobotBrowserCapture, WebRobotRecipe } from '@nao/shared/web-robot';
import type { inferRouterOutputs } from '@trpc/server';

export type RouterOutputs = inferRouterOutputs<TrpcRouter>;
export type WebRobotListItem = RouterOutputs['webRobot']['list'][number];
export type WebRobotDetail = RouterOutputs['webRobot']['get'];
export type WebRobotRun = RouterOutputs['webRobot']['listRuns'][number];
export type WebRobotTestResult = RouterOutputs['webRobot']['testRecipe'];
export type WebRobotInspectResult = RouterOutputs['webRobot']['inspectUrl'];
export type WebRobotAuthoringResult = RouterOutputs['webRobot']['createFromUrl'];

export type WebSourceFormSubmit = {
	name: string;
	slug?: string;
	description?: string;
	cron: string;
	enabled: boolean;
	recipe: WebRobotRecipe;
};

export type WebSourceFormInitial = {
	name: string;
	slug?: string;
	description?: string | null;
	cron?: string | null;
	enabled?: boolean;
	recipe: WebRobotRecipe;
};

export const WEB_SOURCE_SCHEDULE_PRESETS = [
	{ value: 'manual', label: 'Manual', cron: '' },
	{ value: 'daily', label: 'Daily at 02:00', cron: '0 2 * * *' },
	{ value: 'weekly', label: 'Weekly on Monday at 02:00', cron: '0 2 * * 1' },
	{ value: 'custom', label: 'Custom cron', cron: '' },
] as const;

export type WebSourceSchedulePreset = (typeof WEB_SOURCE_SCHEDULE_PRESETS)[number]['value'];

export const DEFAULT_WEB_SOURCE_RECIPE_TEXT = `{
  "version": 1,
  "allowedHosts": ["dummyjson.com"],
  "request": {
    "concurrency": 1,
    "delayMs": 250,
    "timeoutMs": 20000,
    "retries": 2
  },
  "limits": {
    "maxPages": 5,
    "maxItems": 100,
    "maxRequests": 100,
    "maxDurationMs": 300000,
    "maxResponseBytes": 2097152
  },
  "publish": {
    "minItems": 1,
    "maxRemovedPercent": 50
  },
  "identity": {
    "fields": ["sku"]
  },
  "respectRobotsTxt": false,
  "stages": [
    {
      "id": "products",
      "source": {
        "type": "api",
        "url": "https://dummyjson.com/products?limit=10"
      },
      "extract": {
        "type": "json",
        "itemsPath": "products",
        "fields": {
          "sku": { "path": "id", "required": true },
          "name": { "path": "title", "required": true },
          "description": { "path": "description" },
          "brand": { "path": "brand" },
          "price": { "path": "price" },
          "categories": { "path": "tags" },
          "images": { "path": "images", "multiple": true }
        }
      },
      "output": "product"
    }
  ]
}`;

export const parseWebSourceRecipe = (text: string): { recipe?: WebRobotRecipe; errors: string[] } => {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return { errors: [`JSON: ${error instanceof Error ? error.message : String(error)}`] };
	}

	const result = webRobotRecipeSchema.safeParse(value);
	if (result.success) {
		return { recipe: result.data, errors: [] };
	}
	return { errors: result.error.issues.map(formatZodIssue) };
};

export const parseBrowserActions = (text: string): { actions?: WebRobotBrowserAction[]; errors: string[] } => {
	const result = parseSchemaArray(text, webRobotBrowserActionSchema, 'browser actions');
	return { actions: result.values, errors: result.errors };
};

export const parseBrowserCaptures = (text: string): { captures?: WebRobotBrowserCapture[]; errors: string[] } => {
	const result = parseSchemaArray(text, webRobotBrowserCaptureSchema, 'network captures');
	return { captures: result.values, errors: result.errors };
};

export const schedulePresetForCron = (cron: string | null | undefined): WebSourceSchedulePreset => {
	const trimmed = cron?.trim() ?? '';
	if (!trimmed) {
		return 'manual';
	}
	if (trimmed === '0 2 * * *') {
		return 'daily';
	}
	if (trimmed === '0 2 * * 1') {
		return 'weekly';
	}
	return 'custom';
};

export const recipeSummary = (recipe?: WebRobotRecipe) => {
	if (!recipe) {
		return null;
	}
	return {
		allowedHosts: recipe.allowedHosts,
		stageCount: recipe.stages.length,
		sourceTypes: [...new Set(recipe.stages.map((stage) => stage.source.type))],
		productStages: recipe.stages.filter((stage) => stage.output === 'product').map((stage) => stage.id),
	};
};

export const isActiveWebRobotRun = (status: WebRobotRun['status'] | null | undefined): boolean => {
	return status === 'queued' || status === 'running';
};

export const webRobotRunBadgeVariant = (
	status: WebRobotRun['status'] | null | undefined,
): 'success' | 'secondary' | 'destructive' | 'outline' | 'context_admin' => {
	switch (status) {
		case 'completed':
			return 'success';
		case 'partial':
			return 'context_admin';
		case 'failed':
			return 'destructive';
		case 'cancelled':
			return 'outline';
		case 'queued':
		case 'running':
			return 'secondary';
		default:
			return 'outline';
	}
};

export const formatDateTime = (value: string | Date | null | undefined): string => {
	if (!value) {
		return '—';
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

export const formatDuration = (
	startedAt: string | Date | null | undefined,
	completedAt: string | Date | null | undefined,
): string => {
	if (!startedAt) {
		return '—';
	}
	const start = new Date(startedAt).getTime();
	const end = completedAt ? new Date(completedAt).getTime() : Date.now();
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
		return '—';
	}
	const seconds = Math.round((end - start) / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) {
		return `${minutes}m ${remainingSeconds}s`;
	}
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
};

export const recipeToText = (recipe: WebRobotRecipe): string => JSON.stringify(recipe, null, 2);

export const slugifyWebSourceName = (name: string): string => {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
};

const parseSchemaArray = <T extends z.ZodTypeAny>(
	text: string,
	schema: T,
	label: string,
): { values?: z.infer<T>[]; errors: string[] } => {
	const trimmed = text.trim();
	if (!trimmed) {
		return { values: [], errors: [] };
	}
	let value: unknown;
	try {
		value = JSON.parse(trimmed);
	} catch (error) {
		return { errors: [`${label}: ${error instanceof Error ? error.message : String(error)}`] };
	}
	const result = z.array(schema).safeParse(value);
	if (!result.success) {
		return { errors: result.error.issues.map((issue) => `${label}: ${formatZodIssue(issue)}`) };
	}
	return { values: result.data, errors: [] };
};

const formatZodIssue = (issue: z.core.$ZodIssue): string => {
	const path = issue.path.map(String).join('.');
	return path ? `${path}: ${issue.message}` : issue.message;
};
