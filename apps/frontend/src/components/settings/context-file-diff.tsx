import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilePen } from 'lucide-react';

import type { LineDiff } from '@/lib/line-diff';
import type { SegmentedControlOption } from '@/components/ui/segmented-control';
import { FileDiffBody } from '@/components/settings/file-diff';
import { MarkdownRenderedDiff } from '@/components/settings/markdown-rendered-diff';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Spinner } from '@/components/ui/spinner';
import { isMarkdownPath } from '@/lib/file-path';
import { computeLineDiff } from '@/lib/line-diff';
import { parseMarkdownFrontmatter } from '@/lib/markdown';
import { trpc } from '@/main';

interface ContextFileDiffProps {
	path: string;
	range?: { from: string; to: string };
}

export function ContextFileDiff({ path, range }: ContextFileDiffProps) {
	const fileDiff = useQuery(
		trpc.contextExplorer.getFileDiff.queryOptions(range ? { path, from: range.from, to: range.to } : { path }),
	);
	const diff = useMemo(
		() => (fileDiff.data ? computeLineDiff(fileDiff.data.oldContent, fileDiff.data.newContent) : null),
		[fileDiff.data],
	);

	if (fileDiff.isLoading) {
		return (
			<div className='flex h-full items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	if (fileDiff.isError && fileDiff.error.data?.code === 'BAD_REQUEST') {
		return (
			<div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
				<p>{range ? 'This historical change is unavailable.' : 'This file no longer has changes.'}</p>
			</div>
		);
	}

	if (fileDiff.isError || !fileDiff.data || !diff) {
		return (
			<div className='flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground'>
				<p>Failed to load changes</p>
				<Button variant='outline' size='sm' onClick={() => fileDiff.refetch()}>
					Retry
				</Button>
			</div>
		);
	}

	return (
		<FileDiffPanel
			path={path}
			changeLabel={getChangeLabel(fileDiff.data.kind)}
			diff={diff}
			contents={{ old: fileDiff.data.oldContent, new: fileDiff.data.newContent }}
		/>
	);
}

type DiffView = 'rendered' | 'lines';

const DIFF_VIEWS: SegmentedControlOption<DiffView>[] = [
	{ value: 'rendered', label: 'Rendered' },
	{ value: 'lines', label: 'Lines' },
];

/**
 * A file's changes under a header naming the file, how it changed and how many lines were added and removed.
 * Markdown files can also show their changes as they render.
 */
export function FileDiffPanel({
	path,
	changeLabel,
	diff,
	contents,
}: {
	path: string;
	changeLabel: string;
	diff: LineDiff;
	contents?: { old: string; new: string };
}) {
	const markdown = contents && isMarkdownPath(path) ? splitMarkdownFrontmatter(contents) : null;
	const [view, setView] = useState<DiffView>(markdown?.hasFrontmatterChange ? 'lines' : 'rendered');

	return (
		<div className='flex h-full min-h-0 flex-col'>
			<div className='flex shrink-0 items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm'>
				<FilePen className='size-3.5 text-muted-foreground' />
				<span className='min-w-0 flex-1 truncate font-mono' title={path}>
					{path}
				</span>
				<span className='text-xs text-muted-foreground'>{changeLabel}</span>
				<span className='font-mono text-xs text-emerald-600 dark:text-emerald-400'>+{diff.additions}</span>
				<span className='font-mono text-xs text-red-600 dark:text-red-400'>-{diff.deletions}</span>
				{markdown && (
					<SegmentedControl label='Diff view' options={DIFF_VIEWS} value={view} onChange={setView} />
				)}
			</div>
			<div className='min-h-0 flex-1 overflow-auto py-2'>
				{markdown && view === 'rendered' ? (
					<>
						{markdown.hasFrontmatterChange && (
							<p className='mx-auto max-w-3xl px-8 pt-2 text-xs text-muted-foreground'>
								The frontmatter changed too, which only Lines shows.
							</p>
						)}
						<MarkdownRenderedDiff oldMarkdown={markdown.oldBody} newMarkdown={markdown.newBody} />
					</>
				) : (
					<FileDiffBody lines={diff.lines} />
				)}
			</div>
		</div>
	);
}

/** The rendered diff shows the bodies only, so a frontmatter change is reported apart. */
function splitMarkdownFrontmatter(contents: { old: string; new: string }) {
	const oldMarkdown = parseMarkdownFrontmatter(contents.old);
	const newMarkdown = parseMarkdownFrontmatter(contents.new);
	return {
		oldBody: oldMarkdown.body,
		newBody: newMarkdown.body,
		hasFrontmatterChange: oldMarkdown.frontmatter !== newMarkdown.frontmatter,
	};
}

function getChangeLabel(kind: 'modified' | 'untracked' | 'deleted'): string {
	if (kind === 'untracked') {
		return 'New file';
	}
	if (kind === 'deleted') {
		return 'Removed';
	}
	return 'Edited';
}
