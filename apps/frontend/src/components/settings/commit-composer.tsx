import { ChevronDown, Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { isMac } from '@/lib/platform';

interface CommitComposerProps {
	message: string;
	selectedCount: number;
	changedCount: number;
	/** The branch the commit creates when committing on the default branch. */
	newBranchName: string | null;
	canCommit: boolean;
	isCommitting: boolean;
	isWritingMessage: boolean;
	onMessageChange: (message: string) => void;
	onWriteMessage: () => void;
	onEditBranchName: () => void;
	onCommit: (options: { push: boolean }) => void;
}

export function CommitComposer({
	message,
	selectedCount,
	changedCount,
	newBranchName,
	canCommit,
	isCommitting,
	isWritingMessage,
	onMessageChange,
	onWriteMessage,
	onEditBranchName,
	onCommit,
}: CommitComposerProps) {
	const isDisabled = !canCommit || isCommitting;

	return (
		<div className='flex flex-col gap-1.5 px-2'>
			<div className='flex items-start rounded-md border bg-background focus-within:ring-1 focus-within:ring-ring'>
				<Textarea
					value={message}
					onChange={(event) => onMessageChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canCommit) {
							event.preventDefault();
							onCommit({ push: true });
						}
					}}
					placeholder={`Message (${isMac ? '⌘↵' : 'Ctrl+↵'} to commit)`}
					aria-label='Commit message'
					disabled={isCommitting || isWritingMessage}
					rows={1}
					className='max-h-32 min-h-0 resize-none border-0 bg-transparent px-2 py-1.5 text-xs shadow-none focus-visible:ring-0 md:text-xs dark:bg-transparent'
				/>
				<Button
					type='button'
					variant='ghost-muted'
					size='icon-xs'
					className='m-0.5 shrink-0'
					aria-label='Write it for me'
					title='Write the message from the selected changes'
					disabled={selectedCount === 0 || isCommitting || isWritingMessage}
					onClick={onWriteMessage}
				>
					{isWritingMessage ? <Loader2 className='animate-spin' /> : <Sparkles />}
				</Button>
			</div>
			<div className='flex'>
				<Button
					size='sm'
					className='h-7 flex-1 rounded-r-none text-xs'
					title={newBranchName ? `Commits on a new branch, ${newBranchName}` : undefined}
					disabled={isDisabled}
					isLoading={isCommitting}
					onClick={() => onCommit({ push: true })}
				>
					{getCommitLabel(selectedCount, changedCount)}
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							size='sm'
							className='h-7 rounded-l-none border-l border-l-primary-foreground/25 px-1.5'
							disabled={isCommitting}
							aria-label='More ways to commit'
						>
							<ChevronDown />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='end' className='w-56 text-xs'>
						<DropdownMenuItem disabled={isDisabled} onSelect={() => onCommit({ push: false })}>
							Commit without pushing
						</DropdownMenuItem>
						{newBranchName && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem onSelect={onEditBranchName}>
									<span className='min-w-0 truncate'>
										Rename branch <span className='font-mono'>{newBranchName}</span>…
									</span>
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

function getCommitLabel(selectedCount: number, changedCount: number): string {
	if (selectedCount === changedCount) {
		return 'Commit & push';
	}
	return `Commit ${selectedCount} of ${changedCount} & push`;
}
