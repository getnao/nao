import { z } from 'zod/v4';

export const WEB_ROBOT_RECIPE_VERSION = 1;

const hostnameSchema = z
	.string()
	.trim()
	.min(1)
	.max(253)
	.regex(/^(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/, {
		message: 'Expected a hostname or wildcard suffix such as www.example.com or *.example.com',
	})
	.refine((host) => {
		const normalized = host.replace(/^\*\./, '').toLowerCase();
		return (
			normalized !== 'localhost' &&
			!normalized.endsWith('.localhost') &&
			!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)
		);
	}, 'IP literals and localhost are not valid web robot hosts');

const urlTemplateSchema = z.string().trim().min(1).max(4096);
const selectorSchema = z.string().trim().min(1).max(2048);
const jsonPathSchema = z.string().trim().min(1).max(2048);

const headerValueSchema = z.union([z.string().max(4096), z.object({ env: z.string().trim().min(1).max(255) })]);

const SENSITIVE_HEADER_NAMES = new Set([
	'authorization',
	'cookie',
	'proxy-authorization',
	'x-api-key',
	'x-auth-token',
	'x-csrf-token',
]);

const headersSchema = z
	.record(z.string().trim().min(1).max(128), headerValueSchema)
	.default({})
	.superRefine((headers, ctx) => {
		for (const [name, value] of Object.entries(headers)) {
			if (typeof value === 'string' && SENSITIVE_HEADER_NAMES.has(name.toLowerCase())) {
				ctx.addIssue({
					code: 'custom',
					message: `Header '${name}' must use { "env": "VARIABLE_NAME" } instead of a literal secret`,
					path: [name],
				});
			}
		}
	});

const simpleTransformSchema = z.enum([
	'trim',
	'normalizeWhitespace',
	'lowercase',
	'uppercase',
	'absoluteUrl',
	'stripHtml',
	'parseNumber',
	'parsePrice',
	'hashValue',
]);

const transformSchema = z.union([
	simpleTransformSchema,
	z.object({ type: z.literal('regex'), pattern: z.string().min(1), group: z.number().int().min(0).optional() }),
	z.object({ type: z.literal('replace'), pattern: z.string().min(1), replacement: z.string().default('') }),
	z.object({ type: z.literal('join'), separator: z.string().max(64).default('\n') }),
	z.object({ type: z.literal('map'), values: z.record(z.string(), z.unknown()) }),
]);

const transformsSchema = z.array(transformSchema).max(32).default([]);

const elementFingerprintSchema = z.object({
	tag: z.string().trim().min(1).max(64),
	attributes: z
		.record(z.string().trim().min(1).max(128), z.string().max(1024))
		.refine(
			(attributes) => Object.keys(attributes).length <= 32,
			'Element fingerprints can contain at most 32 attributes',
		)
		.default({}),
	classes: z.array(z.string().trim().min(1).max(128)).max(16).default([]),
	childTags: z.array(z.string().trim().min(1).max(64)).max(32).default([]),
	text: z.string().trim().max(512).optional(),
});

const domValueFieldSchema = z.object({
	selector: selectorSchema.optional(),
	selectors: z.array(selectorSchema).min(1).max(8).optional(),
	fingerprint: elementFingerprintSchema.optional(),
	attr: z.string().trim().min(1).max(255).optional(),
	format: z.enum(['text', 'html']).default('text'),
	multiple: z.boolean().default(false),
	required: z.boolean().default(false),
	default: z.unknown().optional(),
	transforms: transformsSchema,
});

const domFieldSchema = domValueFieldSchema.extend({
	each: selectorSchema.optional(),
	name: selectorSchema.optional(),
	value: selectorSchema.optional(),
	unit: selectorSchema.optional(),
	fields: z.record(z.string().trim().min(1).max(128), domValueFieldSchema).optional(),
});

const jsonFieldSchema = z.object({
	path: jsonPathSchema.optional(),
	multiple: z.boolean().default(false),
	required: z.boolean().default(false),
	default: z.unknown().optional(),
	transforms: transformsSchema,
});

const recordFilterSchema = z
	.object({
		path: jsonPathSchema,
		equals: z.unknown().optional(),
		in: z.array(z.unknown()).min(1).max(128).optional(),
		exists: z.boolean().optional(),
	})
	.superRefine((filter, ctx) => {
		if (filter.equals === undefined && filter.in === undefined && filter.exists === undefined) {
			ctx.addIssue({
				code: 'custom',
				message: 'Record filters require equals, in, or exists',
			});
		}
	});

const recordFiltersSchema = z.array(recordFilterSchema).max(16).default([]);

const domExtractSchema = z.object({
	type: z.literal('dom'),
	itemSelector: selectorSchema.optional(),
	itemSelectors: z.array(selectorSchema).min(1).max(8).optional(),
	itemFingerprint: elementFingerprintSchema.optional(),
	fields: z.record(z.string().trim().min(1).max(128), domFieldSchema).default({}),
});

const jsonExtractSchema = z.object({
	type: z.literal('json'),
	itemsPath: jsonPathSchema.optional(),
	where: recordFiltersSchema,
	fields: z.record(z.string().trim().min(1).max(128), jsonFieldSchema).default({}),
});

const networkExtractSchema = jsonExtractSchema.extend({
	type: z.literal('network'),
	capture: z.string().trim().min(1).max(128),
});

const embeddedExtractSchema = jsonExtractSchema.extend({
	type: z.literal('embedded'),
	sources: z
		.array(z.enum(['jsonld', 'microdata', 'rdfa', 'openGraph', 'scriptJson']))
		.min(1)
		.max(5)
		.default(['jsonld', 'microdata', 'rdfa', 'openGraph']),
	schemaTypes: z.array(z.string().trim().min(1).max(128)).min(1).optional(),
});

const jsonLdExtractSchema = z.object({
	type: z.literal('jsonld'),
	schemaTypes: z.array(z.string().trim().min(1).max(128)).min(1).default(['Product']),
	fields: z.record(z.string().trim().min(1).max(128), jsonFieldSchema).default({}),
});

const extractSchema = z.discriminatedUnion('type', [
	domExtractSchema,
	jsonExtractSchema,
	networkExtractSchema,
	embeddedExtractSchema,
	jsonLdExtractSchema,
]);

const httpSourceSchema = z.object({
	type: z.literal('http'),
	url: urlTemplateSchema,
	method: z.enum(['GET', 'POST']).default('GET'),
	headers: headersSchema,
	body: z.unknown().optional(),
});

const apiSourceSchema = z.object({
	type: z.literal('api'),
	url: urlTemplateSchema,
	method: z.enum(['GET', 'POST']).default('GET'),
	query: z.record(z.string(), z.unknown()).default({}),
	headers: headersSchema,
	body: z.unknown().optional(),
});

export const webRobotBrowserActionSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('waitForSelector'),
		selector: selectorSchema,
		timeoutMs: z.number().int().min(1).max(120_000).optional(),
	}),
	z.object({
		type: z.literal('waitForResponse'),
		urlPattern: z.string().trim().min(1).max(2048),
		timeoutMs: z.number().int().min(1).max(120_000).optional(),
	}),
	z.object({ type: z.literal('waitForNavigation'), timeoutMs: z.number().int().min(1).max(120_000).optional() }),
	z.object({
		type: z.literal('click'),
		selector: selectorSchema,
		selectors: z.array(selectorSchema).min(1).max(8).optional(),
	}),
	z.object({ type: z.literal('select'), selector: selectorSchema, value: z.string().max(2048) }),
	z.object({
		type: z.literal('scroll'),
		times: z.number().int().min(1).max(50).default(5),
		delayMs: z.number().int().min(0).max(10_000).default(250),
	}),
	z.object({ type: z.literal('delay'), ms: z.number().int().min(0).max(30_000) }),
]);

export const webRobotBrowserCaptureSchema = z.object({
	name: z.string().trim().min(1).max(128),
	urlPattern: z.string().trim().min(1).max(2048),
	body: z.enum(['json', 'text']).default('json'),
});

const browserSourceSchema = z.object({
	type: z.literal('browser'),
	url: urlTemplateSchema,
	headers: headersSchema,
	viewport: z
		.object({
			width: z.number().int().min(320).max(3840).default(1440),
			height: z.number().int().min(320).max(3840).default(1000),
		})
		.default({ width: 1440, height: 1000 }),
	actions: z.array(webRobotBrowserActionSchema).max(32).default([]),
	capture: z.array(webRobotBrowserCaptureSchema).max(16).default([]),
});

const sourceSchema = z.discriminatedUnion('type', [httpSourceSchema, apiSourceSchema, browserSourceSchema]);

const paginationSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('page'),
		pageVariable: z.string().trim().min(1).max(128).default('page'),
		firstPage: z.number().int().min(0).default(1),
		totalPagesPath: jsonPathSchema.optional(),
		maxPages: z.number().int().min(1).max(10_000).default(100),
	}),
	z.object({
		type: z.literal('nextLink'),
		selector: selectorSchema,
		selectors: z.array(selectorSchema).min(1).max(8).optional(),
		fingerprint: elementFingerprintSchema.optional(),
		attr: z.string().trim().min(1).max(255).default('href'),
		maxPages: z.number().int().min(1).max(10_000).default(100),
	}),
	z.object({
		type: z.literal('click'),
		selector: selectorSchema,
		selectors: z.array(selectorSchema).min(1).max(8).optional(),
		fingerprint: elementFingerprintSchema.optional(),
		waitMs: z.number().int().min(0).max(10_000).default(500),
		maxPages: z.number().int().min(1).max(10_000).default(100),
	}),
	z.object({
		type: z.literal('scroll'),
		waitMs: z.number().int().min(0).max(10_000).default(1_000),
		maxPages: z.number().int().min(1).max(10_000).default(100),
	}),
	z.object({
		type: z.literal('nextPath'),
		path: jsonPathSchema,
		maxPages: z.number().int().min(1).max(10_000).default(100),
	}),
	z.object({
		type: z.literal('cursor'),
		cursorVariable: z.string().trim().min(1).max(128).default('cursor'),
		firstCursor: z.string().max(4096).optional(),
		nextCursorPath: jsonPathSchema,
		maxPages: z.number().int().min(1).max(10_000).default(100),
	}),
	z.object({
		type: z.literal('offset'),
		offsetVariable: z.string().trim().min(1).max(128).default('offset'),
		firstOffset: z.number().int().min(0).default(0),
		pageSize: z.number().int().min(1).max(1_000),
		totalPath: jsonPathSchema.optional(),
		maxPages: z.number().int().min(1).max(10_000).default(100),
	}),
]);

const streamNameSchema = z
	.string()
	.trim()
	.min(1)
	.max(128)
	.regex(
		/^[A-Za-z][A-Za-z0-9_-]*$/,
		'Stream names must start with a letter and contain only letters, numbers, hyphens, or underscores',
	);

const forEachSchema = z.object({
	from: streamNameSchema,
	limit: z.number().int().min(1).max(10_000).optional(),
});

const stageSchema = z
	.object({
		id: z
			.string()
			.trim()
			.min(1)
			.max(128)
			.regex(
				/^[A-Za-z][A-Za-z0-9_-]*$/,
				'Stage ids must start with a letter and contain only letters, numbers, hyphens, or underscores',
			),
		forEach: forEachSchema.optional(),
		source: sourceSchema,
		paginate: paginationSchema.optional(),
		extract: extractSchema.optional(),
		emit: streamNameSchema.optional(),
		output: z.literal('product').optional(),
	})
	.superRefine((stage, ctx) => {
		if (
			(stage.paginate?.type === 'click' || stage.paginate?.type === 'scroll') &&
			stage.source.type !== 'browser'
		) {
			ctx.addIssue({
				code: 'custom',
				message: 'Click and scroll pagination require a browser source',
				path: ['paginate', 'type'],
			});
		}
		if (
			(stage.paginate?.type === 'cursor' || stage.paginate?.type === 'offset') &&
			stage.source.type === 'browser'
		) {
			ctx.addIssue({
				code: 'custom',
				message: 'Cursor and offset pagination require an HTTP or API source',
				path: ['paginate', 'type'],
			});
		}
		const extract = stage.extract;
		if (extract?.type !== 'network') {
			return;
		}
		if (stage.source.type !== 'browser') {
			ctx.addIssue({
				code: 'custom',
				message: 'Network extraction requires a browser source',
				path: ['extract', 'type'],
			});
			return;
		}
		if (!stage.source.capture.some((capture) => capture.name === extract.capture)) {
			ctx.addIssue({
				code: 'custom',
				message: `Unknown network capture '${extract.capture}'`,
				path: ['extract', 'capture'],
			});
		}
	});

export const webRobotRecipeSchema = z
	.object({
		version: z.literal(WEB_ROBOT_RECIPE_VERSION),
		allowedHosts: z.array(hostnameSchema).min(1).max(32),
		request: z
			.object({
				concurrency: z.number().int().min(1).max(4).default(1),
				delayMs: z.number().int().min(0).max(60_000).default(500),
				timeoutMs: z.number().int().min(100).max(120_000).default(20_000),
				retries: z.number().int().min(0).max(5).default(2),
				userAgent: z.string().trim().max(512).optional(),
			})
			.default({ concurrency: 1, delayMs: 500, timeoutMs: 20_000, retries: 2 }),
		limits: z
			.object({
				maxPages: z.number().int().min(1).max(10_000).default(500),
				maxItems: z.number().int().min(1).max(100_000).default(10_000),
				maxRequests: z.number().int().min(1).max(50_000).default(5_000),
				maxDurationMs: z
					.number()
					.int()
					.min(1_000)
					.max(4 * 60 * 60_000)
					.default(30 * 60_000),
				maxResponseBytes: z
					.number()
					.int()
					.min(1024)
					.max(50 * 1024 * 1024)
					.default(5 * 1024 * 1024),
			})
			.default({
				maxPages: 500,
				maxItems: 10_000,
				maxRequests: 5_000,
				maxDurationMs: 30 * 60_000,
				maxResponseBytes: 5 * 1024 * 1024,
			}),
		publish: z
			.object({
				minItems: z.number().int().min(0).max(100_000).default(1),
				maxRemovedPercent: z.number().min(0).max(100).default(50),
			})
			.default({ minItems: 1, maxRemovedPercent: 50 }),
		identity: z
			.object({
				fields: z.array(z.string().trim().min(1).max(128)).min(1).max(8).default(['sku', 'url']),
			})
			.default({ fields: ['sku', 'url'] }),
		respectRobotsTxt: z.boolean().default(false),
		stages: z.array(stageSchema).min(1).max(64),
	})
	.superRefine((recipe, ctx) => {
		const stageIds = new Set<string>();
		const streamNames = new Set<string>();
		for (const [index, stage] of recipe.stages.entries()) {
			if (stageIds.has(stage.id)) {
				ctx.addIssue({
					code: 'custom',
					message: `Duplicate stage id '${stage.id}'`,
					path: ['stages', index, 'id'],
				});
			}
			stageIds.add(stage.id);

			if (stage.forEach && !streamNames.has(stage.forEach.from)) {
				ctx.addIssue({
					code: 'custom',
					message: `Stage '${stage.id}' references unknown or later stage '${stage.forEach.from}'`,
					path: ['stages', index, 'forEach', 'from'],
				});
			}

			const streamName = stage.emit ?? stage.id;
			if (streamNames.has(streamName)) {
				ctx.addIssue({
					code: 'custom',
					message: `Duplicate stage stream '${streamName}'`,
					path: ['stages', index, 'emit'],
				});
			}
			streamNames.add(streamName);
		}

		if (!recipe.stages.some((stage) => stage.output === 'product')) {
			ctx.addIssue({
				code: 'custom',
				message: 'At least one stage must set output to product',
				path: ['stages'],
			});
		}
	});

export type WebRobotRecipe = z.infer<typeof webRobotRecipeSchema>;
export type WebRobotStage = z.infer<typeof stageSchema>;
export type WebRobotSource = z.infer<typeof sourceSchema>;
export type WebRobotExtract = z.infer<typeof extractSchema>;
export type WebRobotRecordFilter = z.infer<typeof recordFilterSchema>;
export type WebRobotElementFingerprint = z.infer<typeof elementFingerprintSchema>;
export type WebRobotBrowserAction = z.infer<typeof webRobotBrowserActionSchema>;
export type WebRobotBrowserCapture = z.infer<typeof webRobotBrowserCaptureSchema>;
export type WebRobotTransform = z.infer<typeof transformSchema>;

export type WebRobotProductRecord = Record<string, unknown> & {
	product_key: string;
	source_url: string;
	canonical_url?: string | null;
	name?: unknown;
	sku?: unknown;
};

export type WebRobotRunStats = {
	pagesDiscovered: number;
	pagesFetched: number;
	requests: number;
	itemsExtracted: number;
	productsAdded: number;
	productsChanged: number;
	productsRemoved: number;
	productsUnchanged: number;
	extractionErrors: number;
	failedRequests: number;
	errors: string[];
	warnings?: string[];
	fieldCoverage?: Record<string, number>;
};

export const emptyWebRobotRunStats = (): WebRobotRunStats => ({
	pagesDiscovered: 0,
	pagesFetched: 0,
	requests: 0,
	itemsExtracted: 0,
	productsAdded: 0,
	productsChanged: 0,
	productsRemoved: 0,
	productsUnchanged: 0,
	extractionErrors: 0,
	failedRequests: 0,
	errors: [],
	warnings: [],
	fieldCoverage: {},
});
