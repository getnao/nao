import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilePen } from 'lucide-react';

import { FileDiffBody } from '@/components/settings/file-diff';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { computeLineDiff } from '@/lib/line-diff';
import { trpc } from '@/main';

export function ContextFileDiff({ path }: { path: string }) {
	const fileDiff = useQuery(trpc.contextExplorer.getFileDiff.queryOptions({ path }));
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
				<p>This file no longer has changes.</p>
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
		<div className='flex h-full min-h-0 flex-col'>
			<div className='flex shrink-0 items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm'>
				<FilePen className='size-3.5 text-muted-foreground' />
				<span className='min-w-0 flex-1 truncate font-mono' title={path}>
					{path}
				</span>
				<span className='text-xs text-muted-foreground'>{getChangeLabel(fileDiff.data.kind)}</span>
				<span className='font-mono text-xs text-emerald-600 dark:text-emerald-400'>+{diff.additions}</span>
				<span className='font-mono text-xs text-red-600 dark:text-red-400'>-{diff.deletions}</span>
			</div>
			<div className='min-h-0 flex-1 overflow-auto py-2'>
				<FileDiffBody lines={diff.lines} />
			</div>
		</div>
	);
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
