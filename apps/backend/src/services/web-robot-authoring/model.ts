import type { LlmProvider } from '@nao/shared/types';
import { generateText } from 'ai';

import { disableModelReasoning, getProviderMeta, type ProviderModelResult } from '../../agents/providers';
import { llmTelemetry } from '../../agents/telemetry';
import * as llmConfigQueries from '../../queries/project-llm-config.queries';
import { resolveDefaultModelSelection, resolveProviderModel } from '../../utils/llm';
import type { WebRobotSourceDiscovery } from './types';

export const generateModelRecipeCandidates = async (
	projectId: string,
	discovery: WebRobotSourceDiscovery,
	failures: string[] = [],
): Promise<unknown[]> => {
	const model = await authoringModel(projectId);
	if (!model) {
		return [];
	}

	const { text } = await generateText({
		...disableModelReasoning(model.provider, model.model),
		system: SYSTEM_PROMPT,
		prompt: JSON.stringify({ discovery: discoverySummary(discovery), failures }, null, 2),
		maxOutputTokens: 12_000,
		temperature: 0.1,
		experimental_telemetry: llmTelemetry('nao-web-robot-authoring', { projectId }),
	});
	return recipeCandidatesFromText(text);
};

const authoringModel = async (
	projectId: string,
): Promise<{ provider: LlmProvider; model: ProviderModelResult } | null> => {
	const pinned = await resolveDefaultModelSelection(projectId, 'other').catch(() => null);
	const provider = pinned?.provider ?? (await llmConfigQueries.getProjectModelProvider(projectId));
	if (!provider) {
		return null;
	}
	const modelId = pinned?.modelId ?? getProviderMeta(provider).extractorModelId;
	const model = await resolveProviderModel(projectId, provider, modelId, false);
	return model ? { provider, model } : null;
};

const recipeCandidatesFromText = (text: string): unknown[] => {
	const parsed = parseJson(text);
	const candidates = Array.isArray(parsed)
		? parsed
		: Array.isArray((parsed as { recipes?: unknown[] } | null)?.recipes)
			? (parsed as { recipes: unknown[] }).recipes
			: parsed && typeof parsed === 'object'
				? [parsed]
				: [];
	return candidates.filter((candidate) => candidate && typeof candidate === 'object').slice(0, 3);
};

const parseJson = (text: string): unknown => {
	const trimmed = text
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '');
	try {
		return JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf('{');
		const end = trimmed.lastIndexOf('}');
		if (start < 0 || end <= start) {
			return null;
		}
		try {
			return JSON.parse(trimmed.slice(start, end + 1));
		} catch {
			return null;
		}
	}
};

const requestBodyShape = (value: unknown, path: string[] = [], depth = 0): string[] => {
	if (depth > 4 || value === null || value === undefined) {
		return path.length ? [path.join('.')] : [];
	}
	if (Array.isArray(value)) {
		return path.length ? [path.join('.')] : [];
	}
	if (typeof value !== 'object') {
		return path.length ? [`${path.join('.')} (${typeof value})`] : [];
	}
	return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
		requestBodyShape(entry, [...path, key], depth + 1),
	);
};

const discoverySummary = (discovery: WebRobotSourceDiscovery) => ({
	url: discovery.url,
	finalUrl: discovery.finalUrl,
	allowedHosts: discovery.allowedHosts,
	title: discovery.title,
	apiCandidates: discovery.apiCandidates.slice(0, 4).map((candidate) => ({
		kind: candidate.kind,
		url: candidate.url,
		method: candidate.method,
		requestContentType: candidate.requestContentType,
		requestBodyShape: candidate.requestBody === undefined ? undefined : requestBodyShape(candidate.requestBody),
		itemsPath: candidate.itemsPath,
		itemCount: candidate.itemCount,
		fields: candidate.fields,
		productUrls: candidate.productUrls.slice(0, 5),
		sample: candidate.sample,
		score: candidate.score,
	})),
	jsonLdCandidates: discovery.jsonLdCandidates.slice(0, 4).map((candidate) => ({
		loader: candidate.loader,
		pageUrl: candidate.pageUrl,
		schemaType: candidate.schemaType,
		itemCount: candidate.itemCount,
		fields: candidate.fields,
		productUrls: candidate.productUrls.slice(0, 5),
		sample: candidate.sample,
		score: candidate.score,
	})),
	embeddedCandidates: discovery.embeddedCandidates.slice(0, 4).map((candidate) => ({
		loader: candidate.loader,
		pageUrl: candidate.pageUrl,
		source: candidate.source,
		itemsPath: candidate.itemsPath,
		schemaTypes: candidate.schemaTypes,
		where: candidate.where,
		itemCount: candidate.itemCount,
		fields: candidate.fields,
		productUrls: candidate.productUrls.slice(0, 5),
		sample: candidate.sample,
		score: candidate.score,
	})),
	domCandidates: discovery.domCandidates.slice(0, 4).map((candidate) => ({
		loader: candidate.loader,
		itemSelector: candidate.itemSelector,
		linkSelector: candidate.linkSelector,
		itemCount: candidate.itemCount,
		fields: candidate.fields,
		productUrls: candidate.productUrls.slice(0, 5),
		sample: candidate.sample,
		score: candidate.score,
	})),
	detailCandidates: discovery.detailCandidates.slice(0, 3),
	paginationCandidates: discovery.paginationCandidates,
	blockers: discovery.blockers,
});

const SYSTEM_PROMPT = `You generate deterministic nao web robot recipes from bounded source-discovery evidence.

Return JSON only, either one recipe object or { "recipes": [recipe] }. Do not include prose or markdown.

Recipe contract:
- version must be 1.
- allowedHosts is supplied by the caller; repeat it exactly.
- request has concurrency, delayMs, timeoutMs, retries, userAgent.
- limits has maxPages, maxItems, maxRequests, maxDurationMs, maxResponseBytes.
- publish has minItems and maxRemovedPercent.
- identity.fields must name stable extracted fields such as sku or url.
- respectRobotsTxt must be false.
- stages is an ordered array of { id, forEach?, source, paginate?, extract?, emit?, output? }.

Sources:
- http: { type:'http', url, method:'GET'|'POST', headers:{}, body? }
- api: { type:'api', url, method:'GET'|'POST', query:{}, headers:{}, body? }
- browser: { type:'browser', url, headers:{}, viewport:{width:1440,height:1000}, actions:[], capture:[] }

Extraction:
- json: { type:'json', itemsPath?, where?:[{path,equals|in|exists}], fields:{ name:{path,required?,multiple?,transforms?} } }
- network: { type:'network', capture:'catalogue', itemsPath?, where?:[{path,equals|in|exists}], fields:{...} }
- embedded: { type:'embedded', sources:['jsonld','microdata','rdfa','openGraph','scriptJson'], itemsPath?, schemaTypes?, where?:[{path,equals|in|exists}], fields:{...} }
- dom: { type:'dom', itemSelector?, itemSelectors?:string[], itemFingerprint?, fields:{ name:{selector?,selectors?:string[],fingerprint?,attr?,required?,multiple?,transforms?} } }
- jsonld: { type:'jsonld', schemaTypes:['Product'], fields:{...} }
- fingerprints: { tag, attributes:{}, classes:[], childTags:[], text? } are deterministic relocation hints copied from discovery; do not invent them

Pagination:
- { type:'page', pageVariable:'page', firstPage:1,totalPagesPath?,maxPages }
- { type:'nextLink', selector, selectors?:string[], fingerprint?, attr:'href', maxPages }
- { type:'click', selector, selectors?:string[], fingerprint?, waitMs, maxPages } for browser sources with observed next/load-more controls
- { type:'scroll', waitMs, maxPages } for browser sources with observed scroll-loading
- { type:'nextPath', path, maxPages }
- { type:'cursor', cursorVariable:'cursor', firstCursor?, nextCursorPath, maxPages } for HTTP/API JSON sources
- { type:'offset', offsetVariable:'offset', firstOffset:0, pageSize, totalPath?, maxPages } for HTTP/API JSON sources

Rules:
- Prefer discovered GET JSON APIs, then captured network JSON, then JSON-LD, then DOM.
- Use only observed URLs, JSON paths, selectors, and browser capture names.
- Use transforms only from: trim, normalizeWhitespace, lowercase, uppercase, absoluteUrl, stripHtml, parseNumber, parsePrice, hashValue.
- For POST/cursor/offset APIs, place {{cursor}}, {{offset}}, or the configured page variable in the observed query/body position instead of inventing endpoints.
- A listing stage that feeds details must use emit:'products' and no output.
- A detail stage must use forEach:{from:'products'}, source.url:'{{products.url}}', and output:'product'.
- A single-stage product recipe must use output:'product'.
- Do not invent credentials, headers, JavaScript, browser actions, or URLs outside allowedHosts.
- Keep generated limits conservative and produce at most three candidate recipes.

Example shape:
{
  "version": 1,
  "allowedHosts": ["www.example.com"],
  "request": { "concurrency": 1, "delayMs": 500, "timeoutMs": 20000, "retries": 2, "userAgent": "nao-web-robot/1.0" },
  "limits": { "maxPages": 100, "maxItems": 2000, "maxRequests": 1000, "maxDurationMs": 900000, "maxResponseBytes": 5242880 },
  "publish": { "minItems": 1, "maxRemovedPercent": 50 },
  "identity": { "fields": ["sku", "url"] },
  "respectRobotsTxt": false,
  "stages": [
    {
      "id": "products",
      "source": { "type": "api", "url": "https://www.example.com/api/products", "method": "GET", "query": {}, "headers": {} },
      "extract": { "type": "json", "itemsPath": "items", "fields": { "url": { "path": "url", "required": true, "transforms": ["absoluteUrl"] }, "name": { "path": "name", "required": true }, "sku": { "path": "sku" } } },
      "emit": "products"
    },
    {
      "id": "details",
      "forEach": { "from": "products" },
      "source": { "type": "http", "url": "{{products.url}}", "method": "GET", "headers": {} },
      "extract": { "type": "dom", "fields": { "name": { "selector": "main h1", "transforms": ["normalizeWhitespace"] }, "attributes": { "each": "table tr", "name": "th, td:first-child", "value": "td:nth-child(2)" } } },
      "output": "product"
    }
  ]
}`;
