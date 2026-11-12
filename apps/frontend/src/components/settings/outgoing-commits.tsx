import { Undo2 } from 'lucide-react';
import type { ContextCommit } from '@nao/shared/types';

import { ChangesSection } from '@/components/settings/changes-section';
import { Button } from '@/components/ui/button';
import { getTimeAgo } from '@/lib/time-ago';

/** The commits of the branch not pushed yet, the last of which can be taken back into the changes. */
export function OutgoingCommits({
	commits,
	isUndoing,
	disabled,
	onUndo,
}: {
	commits: ContextCommit[];
	isUndoing: boolean;
	disabled: boolean;
	onUndo: () => void;
}) {
	if (commits.length === 0) {
		return null;
	}

	return (
		<ChangesSection
			title='Outgoing'
			count={commits.length}
			actions={
				<Button
					variant='ghost-muted'
					size='icon-xs'
					className='size-5'
					aria-label='Undo last commit'
					title='Undo last commit, keeping its changes'
					disabled={disabled}
					isLoading={isUndoing}
					onClick={onUndo}
				>
					<Undo2 className='size-3' />
				</Button>
			}
		>
			<ol>
				{commits.map((commit) => (
					<li key={commit.hash} className='flex h-6 min-w-0 items-center gap-2 pr-3 pl-6 text-xs'>
						<span className='min-w-0 flex-1 truncate' title={commit.subject}>
							{commit.subject}
						</span>
						<span className='shrink-0 font-mono text-[10.5px] text-muted-foreground'>
							{getTimeAgo(Date.parse(commit.committedAt)).humanReadable}
						</span>
					</li>
				))}
			</ol>
		</ChangesSection>
	);
}
