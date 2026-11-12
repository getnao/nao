import type { ContextChangedFile } from '@nao/shared/types';

import { cn } from '@/lib/utils';

export type FileChangeKind = 'added' | 'modified' | 'deleted';

const CHANGE_KINDS: Record<FileChangeKind, { letter: string; label: string; className: string }> = {
	added: { letter: 'A', label: 'New', className: 'text-emerald-600 dark:text-emerald-400' },
	modified: { letter: 'M', label: 'Edited', className: 'text-amber-600 dark:text-amber-400' },
	deleted: { letter: 'D', label: 'Removed', className: 'text-red-600 dark:text-red-400' },
};

export function toFileChangeKind(kind: ContextChangedFile['kind'] | FileChangeKind): FileChangeKind {
	return kind === 'untracked' ? 'added' : kind;
}

/** The letter git shows for a change (A, M or D) in its color, read out as the kind of change. */
export function ChangeKindLetter({ kind, className }: { kind: FileChangeKind; className?: string }) {
	const change = CHANGE_KINDS[kind];
	return (
		<span
			title={change.label}
			className={cn('w-2.5 shrink-0 text-center font-mono text-[10.5px] font-bold', change.className, className)}
		>
			<span aria-hidden='true'>{change.letter}</span>
			<span className='sr-only'>{change.label}</span>
		</span>
	);
}

/** The lines a change adds and removes, such as "+12 −3", or nothing when they could not be counted. */
export function describeLineChanges(additions: number | null, deletions: number | null): string | undefined {
	if (additions === null || deletions === null) {
		return undefined;
	}
	return `+${additions} −${deletions}`;
}
