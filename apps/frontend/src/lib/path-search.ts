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
