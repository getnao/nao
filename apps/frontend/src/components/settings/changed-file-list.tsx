import { Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ContextChangedFile } from '@nao/shared/types';

import type { FileChangeKind } from '@/components/settings/change-kind';
import { ChangeKindLetter, describeLineChanges, toFileChangeKind } from '@/components/settings/change-kind';
import { SectionNote } from '@/components/settings/changes-section';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorMessage } from '@/components/ui/error-message';
import { Spinner } from '@/components/ui/spinner';
import { getFileName, getFolderHint } from '@/lib/file-path';
import { cn } from '@/lib/utils';

export interface ChangedFileSelection {
	selectedPaths: Set<string>;
	onToggle: (path: string) => void;
}

interface ChangedFileListProps {
	files: ContextChangedFile[];
	/** Picking the files to commit, left out when the changes cannot be committed. */
	selection?: ChangedFileSelection;
	selectedDiffPath: string | null;
	discardDisabledReason: string | null;
	isLoading: boolean;
	error: string | undefined;
	emptyMessage: string;
	onRetry: () => void;
	onViewDiff: (path: string) => void;
	onDiscard: (file: ContextChangedFile) => void;
}

export function ChangedFileList({
	files,
	selection,
	selectedDiffPath,
	discardDisabledReason,
	isLoading,
	error,
	emptyMessage,
	onRetry,
	onViewDiff,
	onDiscard,
}: ChangedFileListProps) {
	if (isLoading) {
		return (
			<div className='flex justify-center py-2'>
				<Spinner className='size-3.5' />
			</div>
		);
	}
	if (error) {
		return (
			<div className='flex flex-col items-start gap-1.5 px-6 py-1'>
				<ErrorMessage message={error} />
				<Button variant='outline' size='pill' onClick={onRetry}>
					Retry
				</Button>
			</div>
		);
	}
	if (files.length === 0) {
		return <SectionNote>{emptyMessage}</SectionNote>;
	}

	return (
		<>
			{files.map((file) => {
				const fileName = getFileName(file.path) ?? file.path;
				const isSelected = selection?.selectedPaths.has(file.path) ?? true;
				return (
					<ChangeRow
						key={file.path}
						path={file.path}
						kind={toFileChangeKind(file.kind)}
						detail={describeLineChanges(file.additions, file.deletions)}
						isViewing={selectedDiffPath === file.path}
						isDimmed={!isSelected}
						onView={() => onViewDiff(file.path)}
						leading={
							selection && (
								<Checkbox
									checked={isSelected}
									onCheckedChange={() => selection.onToggle(file.path)}
									aria-label={`${isSelected ? 'Exclude' : 'Include'} ${fileName} in commit`}
									className={cn(
										'grid size-3 place-items-center rounded-[3px] border border-muted-foreground/50 bg-transparent shadow-none dark:shadow-none focus-visible:opacity-100 group-hover/row:opacity-100 [&_svg]:size-2.5',
										'data-[state=checked]:border-foreground data-[state=checked]:bg-foreground',
										isSelected && 'opacity-0',
									)}
								/>
							)
						}
						actions={
							<Button
								variant='ghost-no-hover'
								size='icon-xs'
								className='size-5 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 enabled:hover:text-destructive'
								aria-label={`Discard changes to ${fileName}`}
								title={discardDisabledReason ?? 'Discard changes'}
								disabled={discardDisabledReason !== null}
								onClick={() => onDiscard(file)}
							>
								<Undo2 className='size-3' />
							</Button>
						}
					/>
				);
			})}
		</>
	);
}

export function ChangeRow({
	path,
	kind,
	detail,
	isViewing,
	isDimmed = false,
	leading,
	actions,
	onView,
}: {
	path: string;
	kind: FileChangeKind;
	detail?: string;
	isViewing: boolean;
	isDimmed?: boolean;
	leading?: ReactNode;
	actions?: ReactNode;
	onView: () => void;
}) {
	const fileName = getFileName(path) ?? path;

	return (
		<div
			className={cn(
				'group/row mx-1 flex h-6 min-w-0 items-center gap-1 rounded-md pr-1.5 pl-1 text-xs transition-colors',
				isViewing ? 'bg-muted' : 'hover:bg-muted/50',
			)}
		>
			<span className='flex w-3 shrink-0 items-center justify-center'>{leading}</span>
			<button
				type='button'
				onClick={onView}
				aria-label={`View changes to ${fileName}`}
				title={detail ? `${path} · ${detail}` : path}
				className={cn(
					'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left outline-none focus-visible:underline',
					isDimmed && 'opacity-50',
				)}
			>
				<span className={cn('max-w-[70%] shrink-0 truncate', kind === 'deleted' && 'line-through')}>
					{fileName}
				</span>
				<span className='min-w-0 flex-1 truncate text-[11px] text-muted-foreground'>{getFolderHint(path)}</span>
			</button>
			{actions}
			<ChangeKindLetter kind={kind} className={cn(isDimmed && 'opacity-50')} />
		</div>
	);
}
