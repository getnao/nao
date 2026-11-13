export function matchesOrderedTerms(path: string, terms: string[]): boolean {
	const lowercasedPath = path.toLowerCase();
	let cursor = 0;

	for (const term of terms) {
		const matchIndex = lowercasedPath.indexOf(term, cursor);
		if (matchIndex === -1) {
			return false;
		}
		cursor = matchIndex + term.length;
	}

	return true;
}

/**
 * Ranks the paths matching every word of the query, the way editors' "go to file" does: a word matches as a substring
 * or as a subsequence of the path, and scores higher when it falls in the file name.
 */
export function rankPathsByQuery(paths: string[], query: string): string[] {
	const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
	if (terms.length === 0) {
		return paths;
	}
	return paths
		.flatMap((path) => {
			const score = scorePath(path, terms);
			return score === null ? [] : [{ path, score }];
		})
		.sort((left, right) => right.score - left.score || left.path.length - right.path.length)
		.map(({ path }) => path);
}

function scorePath(path: string, terms: string[]): number | null {
	const lowercasedPath = path.toLowerCase();
	const lowercasedName = lowercasedPath.slice(lowercasedPath.lastIndexOf('/') + 1);
	let score = 0;
	for (const term of terms) {
		const termScore = scoreTerm(lowercasedPath, lowercasedName, term);
		if (termScore === null) {
			return null;
		}
		score += termScore;
	}
	return score;
}

function scoreTerm(path: string, name: string, term: string): number | null {
	if (name.startsWith(term)) {
		return 5;
	}
	if (name.includes(term)) {
		return 4;
	}
	if (path.includes(term)) {
		return 3;
	}
	if (isSubsequence(name, term)) {
		return 2;
	}
	if (isSubsequence(path, term)) {
		return 1;
	}
	return null;
}

/** Compares code units on both sides, so a term holding an emoji can match. */
function isSubsequence(text: string, term: string): boolean {
	let cursor = 0;
	for (const codeUnit of text.split('')) {
		if (codeUnit === term[cursor]) {
			cursor++;
			if (cursor === term.length) {
				return true;
			}
		}
	}
	return false;
}
