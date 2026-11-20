import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, TriangleAlert } from 'lucide-react';
import type { ContextFileHeaderProblems } from '@nao/shared/context-file-header';

import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { useContextChanges } from '@/hooks/use-context-changes';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

/**
 * A warning panel listing the Markdown files whose header is broken or names an owner who is not a user of the project.
 * It shows only when there is something to fix.
 */
export function FileHeaderProblems({
	selectedPath,
	onOpenFile,
}: {
	selectedPath: string | null;
	onOpenFile: (path: string) => void;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const problems = useFileHeaderProblems();
	if (problems.length === 0) {
		return null;
	}

	return (
		<section
			aria-label='File header problems'
			className='flex max-h-[40%] shrink-0 flex-col border-t bg-amber-500/5'
		>
			<button
				type='button'
				aria-expanded={isOpen}
				onClick={() => setIsOpen(!isOpen)}
				className='flex h-8 shrink-0 cursor-pointer items-center gap-1.5 px-2 text-xs font-medium text-amber-700 outline-none hover:bg-amber-500/10 focus-visible:bg-amber-500/10 dark:text-amber-400'
			>
				<ChevronRight
					aria-hidden='true'
					className={cn('size-3 shrink-0 transition-transform', isOpen && 'rotate-90')}
				/>
				<TriangleAlert aria-hidden='true' className='size-3.5 shrink-0' />
				<span className='truncate'>
					{problems.length} {problems.length === 1 ? 'file has' : 'files have'} header problems
				</span>
			</button>
			{isOpen && (
				<ul className='min-h-0 overflow-auto pb-1.5'>
					{problems.map((file) => (
						<ProblemFileRow
							key={file.path}
							file={file}
							isSelected={file.path === selectedPath}
							onOpen={() => onOpenFile(file.path)}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

function ProblemFileRow({
	file,
	isSelected,
	onOpen,
}: {
	file: ContextFileHeaderProblems;
	isSelected: boolean;
	onOpen: () => void;
}) {
	const segments = file.path.split('/').filter(Boolean);
	const fileName = segments.pop() ?? file.path;

	return (
		<li>
			<button
				type='button'
				onClick={onOpen}
				title={file.path}
				className={cn(
					'flex w-full cursor-pointer flex-col gap-0.5 px-3 py-1 text-left outline-none hover:bg-accent focus-visible:bg-accent',
					isSelected && 'bg-accent',
				)}
			>
				<span className='flex w-full min-w-0 items-center gap-1.5 text-xs'>
					<FileExplorerIcon name={fileName} type='file' path={file.path} className='size-3.5' />
					<span className='shrink-0 text-foreground'>{fileName}</span>
					<span className='truncate text-muted-foreground'>{segments.join('/')}</span>
				</span>
				{file.problems.map((problem) => (
					<span key={problem.message} className='pl-5 text-[11px] text-amber-700 dark:text-amber-400'>
						{problem.message}
					</span>
				))}
			</button>
		</li>
	);
}

/** The header problems, checked again whenever the files of the context change. */
function useFileHeaderProblems(): ContextFileHeaderProblems[] {
	const problems = useQuery(trpc.contextExplorer.getFileHeaderProblems.queryOptions());
	const changedFilesUpdatedAt = useContextChanges().changedFiles.dataUpdatedAt;
	const checkedAtRef = useRef(changedFilesUpdatedAt);
	const { refetch } = problems;

	useEffect(() => {
		if (checkedAtRef.current === changedFilesUpdatedAt) {
			return;
		}
		checkedAtRef.current = changedFilesUpdatedAt;
		void refetch();
	}, [changedFilesUpdatedAt, refetch]);

	return problems.data ?? [];
}
