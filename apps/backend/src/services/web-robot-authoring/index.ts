import { webRobotRecipeSchema } from '@nao/shared/web-robot';

import { runWebRobotRecipe } from '../web-scraper';
import { discoverWebRobotSource } from './discovery';
import { generateDeterministicCandidates, type GeneratedWebRobotCandidate, sanitizeAuthoredRecipe } from './generate';
import { MIN_AUTHORING_SCORE, scoreExecution } from './score';
import type {
	TestedWebRobotCandidate,
	WebRobotAuthoringCandidateDiagnostic,
	WebRobotAuthoringDiagnostics,
	WebRobotAuthoringResult,
	WebRobotSourceDiscovery,
} from './types';

const MAX_DETERMINISTIC_CANDIDATES = 8;
const MAX_MODEL_CANDIDATES = 3;
const MAX_MODEL_ATTEMPTS = 2;
const EARLY_ACCEPT_SCORE = 90;
const INTERACTIVE_BLOCKER_KINDS = new Set(['bot_challenge', 'captcha', 'consent', 'login']);

export const authorWebRobotRecipeFromUrl = async (options: {
	projectId: string;
	url: string;
	env: Record<string, string>;
}): Promise<WebRobotAuthoringResult> => {
	let discovery: WebRobotSourceDiscovery;
	try {
		discovery = await discoverWebRobotSource({ url: options.url, env: options.env });
	} catch (error) {
		return rejected(
			`Could not inspect the catalogue URL: ${errorMessage(error)}`,
			emptyDiagnostics(options.url),
			[],
		);
	}

	const diagnostics = diagnosticsFor(discovery);
	const warnings = [
		...discovery.blockers.map((blocker) => blocker.message),
		...discovery.warnings,
		...discovery.errors,
	];
	const deterministic = generateDeterministicCandidates(discovery).slice(0, MAX_DETERMINISTIC_CANDIDATES);
	const tested = await testCandidates(deterministic, discovery, options.env, EARLY_ACCEPT_SCORE);
	const allTested = [...tested];
	diagnostics.candidates.push(...tested.map(candidateDiagnostic));
	const accepted = bestAccepted(tested);
	if (accepted?.result) {
		const reason = partialReason(accepted, tested, discovery);
		return reason ? partial(accepted, reason, warnings, diagnostics) : ready(accepted, warnings, diagnostics);
	}

	const failures = tested.map(
		(candidate) => `${candidate.strategy}: ${candidate.error ?? `score ${candidate.score}`}`,
	);
	for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt += 1) {
		let modelCandidates: unknown[] = [];
		try {
			const { generateModelRecipeCandidates } = await import('./model');
			modelCandidates = await generateModelRecipeCandidates(options.projectId, discovery, failures);
		} catch (error) {
			warnings.push(`Model-assisted recipe generation failed: ${errorMessage(error)}`);
			break;
		}
		if (modelCandidates.length === 0) {
			break;
		}
		const generated = modelCandidates.slice(0, MAX_MODEL_CANDIDATES).map((recipe, index) => ({
			id: `model-${attempt}-${index}`,
			strategy: 'model',
			recipe,
		}));
		const modelTested = await testCandidates(generated, discovery, options.env);
		allTested.push(...modelTested);
		diagnostics.candidates.push(...modelTested.map(candidateDiagnostic));
		const modelAccepted = bestAccepted(modelTested);
		if (modelAccepted?.result) {
			const reason = partialReason(modelAccepted, allTested, discovery);
			return reason
				? partial(modelAccepted, reason, warnings, diagnostics)
				: ready(modelAccepted, warnings, diagnostics);
		}
		failures.push(
			...modelTested.map(
				(candidate) => `${candidate.strategy}: ${candidate.error ?? `score ${candidate.score}`}`,
			),
		);
	}

	const best = bestRejected(allTested);
	const interactiveBlocker = discovery.blockers.find((blocker) => INTERACTIVE_BLOCKER_KINDS.has(blocker.kind));
	if (interactiveBlocker) {
		return {
			status: 'interactive_needed',
			reason: interactiveBlocker.message,
			recipe: best?.recipe,
			sampleProducts: best?.result ? sampleProducts(best.result.normalized.products) : undefined,
			warnings,
			diagnostics,
		};
	}
	if (best && isExecutedCandidate(best) && best.result.normalized.products.length > 0) {
		return partial(
			best,
			best.error ?? 'Generated recipe produced only a partial catalogue.',
			warnings,
			diagnostics,
		);
	}
	return {
		status: 'rejected',
		reason: 'No generated recipe passed the bounded dry-run quality gate.',
		recipe: best?.recipe,
		sampleProducts: best?.result ? sampleProducts(best.result.normalized.products) : undefined,
		warnings,
		diagnostics,
	};
};

const testCandidates = async (
	candidates: GeneratedWebRobotCandidate[],
	discovery: WebRobotSourceDiscovery,
	env: Record<string, string>,
	stopAtScore?: number,
): Promise<TestedWebRobotCandidate[]> => {
	const tested: TestedWebRobotCandidate[] = [];
	for (const candidate of candidates) {
		const { recipe: _untrustedRecipe, ...candidateMetadata } = candidate;
		const parsed = webRobotRecipeSchema.safeParse(candidate.recipe);
		if (!parsed.success) {
			tested.push({
				...candidateMetadata,
				score: 0,
				error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
			});
			continue;
		}
		const recipe = sanitizeAuthoredRecipe(parsed.data, discovery);
		try {
			const result = await runWebRobotRecipe({ recipe, env, dryRun: true });
			const scored = scoreExecution(recipe, result);
			tested.push({ ...candidate, recipe, result, score: scored.score, error: scored.reason });
			if (stopAtScore !== undefined && scored.score >= stopAtScore) {
				break;
			}
		} catch (error) {
			tested.push({ ...candidate, recipe, score: 0, error: errorMessage(error) });
		}
	}
	return tested;
};

type ExecutedCandidate = TestedWebRobotCandidate & {
	recipe: NonNullable<TestedWebRobotCandidate['recipe']>;
	result: NonNullable<TestedWebRobotCandidate['result']>;
};

const isExecutedCandidate = (candidate: TestedWebRobotCandidate): candidate is ExecutedCandidate =>
	Boolean(candidate.recipe && candidate.result);

const ready = (
	candidate: ExecutedCandidate,
	warnings: string[],
	diagnostics: WebRobotAuthoringDiagnostics,
): WebRobotAuthoringResult => ({
	status: 'ready',
	recipe: candidate.recipe,
	score: candidate.score,
	sampleProducts: sampleProducts(candidate.result.normalized.products),
	warnings,
	diagnostics,
});

const partial = (
	candidate: ExecutedCandidate,
	reason: string,
	warnings: string[],
	diagnostics: WebRobotAuthoringDiagnostics,
): WebRobotAuthoringResult => ({
	status: 'partial',
	reason,
	recipe: candidate.recipe,
	score: candidate.score,
	sampleProducts: sampleProducts(candidate.result.normalized.products),
	warnings,
	diagnostics,
});

const partialReason = (
	accepted: ExecutedCandidate,
	tested: TestedWebRobotCandidate[],
	discovery: WebRobotSourceDiscovery,
): string | undefined => {
	const acceptedUsesPagination = accepted.recipe.stages.some((stage) => stage.paginate);
	const attemptedPaginationFailed = tested.some(
		(candidate) => candidate.error && candidate.recipe?.stages.some((stage) => stage.paginate),
	);
	if (!acceptedUsesPagination && discovery.paginationCandidates.length > 0 && attemptedPaginationFailed) {
		return 'Only the first catalogue page passed the dry run; discovered pagination failed.';
	}
	if (accepted.result.stats.failedRequests > 0 || accepted.result.stats.extractionErrors > 0) {
		return 'The recipe produced products, but some requests or extractions failed during the dry run.';
	}
	const blockerWarning = accepted.result.events.some(
		(event) =>
			event.type === 'warning' &&
			typeof event.data === 'object' &&
			event.data !== null &&
			(event.data as { kind?: string }).kind === 'blocker_detected',
	);
	if (blockerWarning) {
		return 'The recipe produced products, but the source also showed a blocker or interactive wall.';
	}
	const coverage = accepted.result.stats.fieldCoverage ?? {};
	const extractsSku = accepted.recipe.stages.some(
		(stage) => stage.output === 'product' && stage.extract && 'sku' in stage.extract.fields,
	);
	if ((coverage.url ?? 100) < 80 || (coverage.name ?? 100) < 80 || (extractsSku && (coverage.sku ?? 100) < 50)) {
		return 'The recipe produced products, but required product fields have low coverage.';
	}
	return undefined;
};

const bestAccepted = (tested: TestedWebRobotCandidate[]): ExecutedCandidate | undefined => {
	return tested
		.filter((candidate): candidate is ExecutedCandidate => isExecutedCandidate(candidate))
		.filter((candidate) => candidate.score >= MIN_AUTHORING_SCORE)
		.sort((left, right) => right.score - left.score)[0];
};

const bestRejected = (tested: TestedWebRobotCandidate[]): TestedWebRobotCandidate | undefined => {
	return tested
		.filter((candidate) => candidate.recipe && typeof candidate.recipe === 'object')
		.sort((left, right) => right.score - left.score)[0];
};

const sampleProducts = (products: Record<string, unknown>[]): Record<string, unknown>[] => {
	return products.slice(0, 5).map((product) => ({
		product_key: product.product_key,
		source_url: product.source_url,
		canonical_url: product.canonical_url,
		name: product.name,
		sku: product.sku,
		brand: product.brand,
		price: product.price,
		currency: product.currency,
	}));
};

const diagnosticsFor = (discovery: WebRobotSourceDiscovery): WebRobotAuthoringDiagnostics => ({
	discovery: {
		url: discovery.url,
		finalUrl: discovery.finalUrl,
		allowedHosts: discovery.allowedHosts,
		title: discovery.title,
		counts: {
			api: discovery.apiCandidates.length,
			endpoint: discovery.endpointCandidates.length,
			jsonLd: discovery.jsonLdCandidates.length,
			embedded: discovery.embeddedCandidates.length,
			dom: discovery.domCandidates.length,
			detail: discovery.detailCandidates.length,
			pagination: discovery.paginationCandidates.length,
			actions: discovery.browserActionCandidates.length,
		},
		pagination: discovery.paginationCandidates.map((candidate) => ({
			type: candidate.type,
			...('selector' in candidate ? { selector: candidate.selector } : {}),
			...('observed' in candidate ? { observed: candidate.observed } : {}),
		})),
		actions: discovery.browserActionCandidates,
		endpoints: discovery.endpointCandidates,
		blockers: discovery.blockers,
	},
	candidates: [],
});

const candidateDiagnostic = (candidate: TestedWebRobotCandidate): WebRobotAuthoringCandidateDiagnostic => ({
	id: candidate.id,
	strategy: candidate.strategy,
	status: candidate.result && candidate.score >= MIN_AUTHORING_SCORE ? 'accepted' : 'rejected',
	score: candidate.score,
	error: candidate.error,
	stats: candidate.result
		? {
				itemsExtracted: candidate.result.stats.itemsExtracted,
				products: candidate.result.normalized.products.length,
				failedRequests: candidate.result.stats.failedRequests,
				extractionErrors: candidate.result.stats.extractionErrors,
			}
		: undefined,
});

const emptyDiagnostics = (url: string): WebRobotAuthoringDiagnostics => ({
	discovery: {
		url,
		finalUrl: url,
		allowedHosts: [],
		counts: {
			api: 0,
			endpoint: 0,
			jsonLd: 0,
			embedded: 0,
			dom: 0,
			detail: 0,
			pagination: 0,
			actions: 0,
		},
		pagination: [],
		actions: [],
		endpoints: [],
		blockers: [],
	},
	candidates: [],
});

const rejected = (
	reason: string,
	diagnostics: WebRobotAuthoringDiagnostics,
	warnings: string[],
): WebRobotAuthoringResult => ({ status: 'rejected', reason, warnings, diagnostics });

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
