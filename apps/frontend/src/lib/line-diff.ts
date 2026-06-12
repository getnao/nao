export type DiffLineType = 'context' | 'add' | 'remove';

export interface DiffLine {
	type: DiffLineType;
	text: string;
	oldNumber: number | null;
	newNumber: number | null;
}

export interface LineDiff {
	lines: DiffLine[];
	additions: number;
	deletions: number;
}

/** Cap LCS work so a pathological large file can't freeze the UI. */
const MAX_LINES = 4000;
const MAX_DP_CELLS = 1_000_000;

/**
 * Computes a GitHub-style line diff between two texts using a longest-common-subsequence
 * walk. Context files (markdown, yaml, sql) are small, so the quadratic table is fine.
 */
export function computeLineDiff(oldText: string, newText: string): LineDiff {
	const a = splitLines(oldText);
	const b = splitLines(newText);
	const m = a.length;
	const n = b.length;

	if (m > MAX_LINES || n > MAX_LINES || exceedsDpBudget(m, n)) {
		return fallbackReplaceAll(a, b);
	}

	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const lines: DiffLine[] = [];
	let additions = 0;
	let deletions = 0;
	let i = 0;
	let j = 0;
	let oldNumber = 1;
	let newNumber = 1;

	while (i < m && j < n) {
		if (a[i] === b[j]) {
			lines.push({ type: 'context', text: a[i], oldNumber: oldNumber++, newNumber: newNumber++ });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			lines.push({ type: 'remove', text: a[i], oldNumber: oldNumber++, newNumber: null });
			deletions++;
			i++;
		} else {
			lines.push({ type: 'add', text: b[j], oldNumber: null, newNumber: newNumber++ });
			additions++;
			j++;
		}
	}
	while (i < m) {
		lines.push({ type: 'remove', text: a[i], oldNumber: oldNumber++, newNumber: null });
		deletions++;
		i++;
	}
	while (j < n) {
		lines.push({ type: 'add', text: b[j], oldNumber: null, newNumber: newNumber++ });
		additions++;
		j++;
	}

	return { lines, additions, deletions };
}

function fallbackReplaceAll(a: string[], b: string[]): LineDiff {
	const lines: DiffLine[] = [
		...a.map((text, idx): DiffLine => ({ type: 'remove', text, oldNumber: idx + 1, newNumber: null })),
		...b.map((text, idx): DiffLine => ({ type: 'add', text, oldNumber: null, newNumber: idx + 1 })),
	];
	return { lines, additions: b.length, deletions: a.length };
}

function splitLines(text: string): string[] {
	return text.length ? text.replaceAll('\r\n', '\n').split('\n') : [];
}

function exceedsDpBudget(m: number, n: number): boolean {
	return (m + 1) * (n + 1) > MAX_DP_CELLS;
}
