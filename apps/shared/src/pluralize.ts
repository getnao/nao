export const pluralize = (word: string, count: number) => {
	if (count === 1) {
		return word;
	}

	const lower = word.toLowerCase();

	if (lower.endsWith('fe')) {
		return word.slice(0, -2) + matchCase('ves', word.slice(-2));
	}
	if (lower.endsWith('f')) {
		return word.slice(0, -1) + matchCase('ves', word.slice(-1));
	}
	if (lower.endsWith('y') && word.length > 1 && !vowels.has(lower.at(-2)!)) {
		return word.slice(0, -1) + matchCase('ies', word.slice(-1));
	}
	if (/(?:s|sh|ch|x|z)$/i.test(word)) {
		return word + matchCase('es', word.slice(-1));
	}

	return word + matchCase('s', word.slice(-1));
};

const vowels = new Set(['a', 'e', 'i', 'o', 'u']);

function matchCase(suffix: string, reference: string): string {
	return reference === reference.toUpperCase() ? suffix.toUpperCase() : suffix.toLowerCase();
}
