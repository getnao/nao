import { askJev, type ChoiceQuestion, type NoulQuestion } from '../typesafe';
import { type ContextCandidate, readCandidateExcerpt } from './candidates';

/** A Choice question takes up to 255 options; smaller batches keep every state well under the token budget. */
const BATCH_SIZE = 200;
const SHORTLIST_SIZE = 10;
const RERANK_EXCERPT_CHARS = 1_200;

export interface RankedCandidate {
	candidate: ContextCandidate;
	relevance: number;
}

export interface ContextRanking {
	results: RankedCandidate[];
	coverage: number;
}

export interface BatchRanking {
	/** Probability, per candidate id, of being the single most useful entry of the batch. */
	probabilities: Record<string, number>;
	/** Probability that the batch holds anything relevant at all. */
	covered: number;
}

interface RankOptions {
	maxResults: number;
	abortSignal?: AbortSignal;
}

/**
 * Ranks context candidates against a query in two Jev passes: a wide pass reads a one-line
 * summary of every candidate and shortlists the most likely ones, then a narrow pass re-reads
 * the shortlist with real excerpts and gives each an absolute relevance.
 */
export async function rankContextCandidates(
	query: string,
	candidates: ContextCandidate[],
	{ maxResults, abortSignal }: RankOptions,
): Promise<ContextRanking> {
	if (candidates.length === 0) {
		return { results: [], coverage: 0 };
	}

	const batches = chunk(candidates, BATCH_SIZE);
	const rankings = await Promise.all(batches.map((batch) => rankBatch(query, batch, abortSignal)));
	const shortlist = shortlistCandidates(candidates, rankings, SHORTLIST_SIZE);
	const results = await rerankShortlist(query, shortlist, abortSignal);

	return {
		results: results.sort((left, right) => right.relevance - left.relevance).slice(0, maxResults),
		coverage: Math.max(...rankings.map((ranking) => ranking.covered)),
	};
}

/**
 * Merges batch rankings into one ordered shortlist. Each probability is scaled by how likely its
 * batch is to hold anything relevant, so a batch that matches nothing cannot outrank one that does.
 */
export function shortlistCandidates(
	candidates: ContextCandidate[],
	rankings: BatchRanking[],
	size: number,
): ContextCandidate[] {
	const scores = new Map<string, number>();
	for (const ranking of rankings) {
		for (const [id, probability] of Object.entries(ranking.probabilities)) {
			scores.set(id, probability * ranking.covered);
		}
	}
	return candidates
		.filter((candidate) => (scores.get(candidate.id) ?? 0) > 0)
		.sort((left, right) => scores.get(right.id)! - scores.get(left.id)!)
		.slice(0, size);
}

async function rankBatch(query: string, batch: ContextCandidate[], abortSignal?: AbortSignal): Promise<BatchRanking> {
	const files = batch.map((candidate) => `${candidate.id}| ${candidate.path} — ${candidate.excerpt}`).join('\n');
	const which: ChoiceQuestion = {
		type: 'choice',
		instructions:
			'Which entry of `files` is the most useful to answer `query`? Each line is an id, the path of a context file or table folder, and the start of its content.',
		criteria: Object.fromEntries(batch.map((candidate) => [candidate.id, null])),
	};
	const covered: NoulQuestion = {
		type: 'noul',
		instructions: 'Does at least one entry of `files` contain what is needed to answer `query`?',
		criteria: {
			true: 'An entry clearly covers the tables, definitions or documentation the query is about',
			false: 'No entry is about the subject of the query',
		},
	};

	const response = await askJev({ query, files }, { which, covered }, { abortSignal });
	return { probabilities: response.answers.which.probabilities, covered: response.answers.covered.noul };
}

async function rerankShortlist(
	query: string,
	shortlist: ContextCandidate[],
	abortSignal?: AbortSignal,
): Promise<RankedCandidate[]> {
	if (shortlist.length === 0) {
		return [];
	}

	const excerpts = await Promise.all(
		shortlist.map((candidate) => readCandidateExcerpt(candidate, RERANK_EXCERPT_CHARS)),
	);
	const files = Object.fromEntries(
		shortlist.map((candidate, index) => [candidate.id, { path: candidate.path, content: excerpts[index] }]),
	);
	const questions = Object.fromEntries(shortlist.map((candidate) => [candidate.id, fitsQuestion(candidate.id)]));

	const response = await askJev({ query, files }, questions, { abortSignal });
	return shortlist.map((candidate) => ({ candidate, relevance: response.answers[candidate.id].noul }));
}

function fitsQuestion(id: string): NoulQuestion {
	return {
		type: 'noul',
		instructions: `Does \`files.${id}\` contain what is needed to answer \`query\`? Judge from its path and content.`,
		criteria: {
			true: 'It defines, documents or holds the data, metric or concept the query is about',
			false: 'It is about something else, or only loosely related',
		},
	};
}

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}
