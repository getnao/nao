import type { RepoBranch } from '@nao/shared/types';

/**
 * Keeps the branches matching every word of the search, in their name or in who last committed to them. A word
 * starting with `@` only matches the committer, as in `@alice`.
 */
export function searchBranches(branches: RepoBranch[], search: string, isMineOnly: boolean): RepoBranch[] {
	const words = search.toLowerCase().split(/\s+/).filter(Boolean);
	return branches.filter(
		(branch) => (!isMineOnly || branch.isMine) && words.every((word) => matchesWord(branch, word)),
	);
}

/** Puts the pinned branch first, then the selected one, keeping the order of the others. */
export function orderBranches(
	branches: RepoBranch[],
	pinnedBranch: string | null,
	selectedBranch: string | null,
): RepoBranch[] {
	const rank = (branch: RepoBranch) => {
		if (branch.name === pinnedBranch) {
			return 0;
		}
		return branch.name === selectedBranch ? 1 : 2;
	};
	return [...branches].sort((left, right) => rank(left) - rank(right));
}

function matchesWord(branch: RepoBranch, word: string): boolean {
	const authorNames = [branch.author?.name, branch.author?.login].map((name) => name?.toLowerCase() ?? '');
	if (word.startsWith('@')) {
		const author = word.slice(1);
		return authorNames.some((name) => name.includes(author));
	}
	return branch.name.toLowerCase().includes(word) || authorNames.some((name) => name.includes(word));
}
