import { SaveIcon } from 'lucide-react';
import type { IconSegmentedToggleOption } from '@/components/ui/icon-segmented-toggle';

import type { StoryStateSession, StoryStateView } from './use-story-state-session';
import { Button } from '@/components/ui/button';
import { IconSegmentedToggle } from '@/components/ui/icon-segmented-toggle';
import { SwitchIndicator } from '@/components/ui/switch';

export function StoryStateHeader({ session }: { session: StoryStateSession }) {
	const { snapshot } = session;
	if (!snapshot) {
		return null;
	}
	const isViewingShared = !snapshot.isOwner && session.view === 'shared';

	return (
		<div className='flex items-center justify-between gap-3 border-b px-4 py-1.5'>
			<div className='flex min-w-0 items-center gap-2'>
				{!snapshot.isOwner && (
					<ViewToggle view={session.view} ownerName={snapshot.ownerName} onViewChange={session.setView} />
				)}
				{session.error && <span className='truncate text-xs text-destructive'>{session.error}</span>}
			</div>
			{isViewingShared ? (
				<span className='text-xs text-muted-foreground'>Changes here are not saved</span>
			) : (
				<SaveControls session={session} />
			)}
		</div>
	);
}

function ViewToggle({
	view,
	ownerName,
	onViewChange,
}: {
	view: StoryStateView;
	ownerName: string | null;
	onViewChange: (view: StoryStateView) => void;
}) {
	const options: IconSegmentedToggleOption<StoryStateView>[] = [
		{ value: 'mine', label: 'Mine' },
		{ value: 'shared', label: ownerName ?? 'Owner' },
	];
	return (
		<IconSegmentedToggle options={options} value={view} onValueChange={onViewChange} showLabels showIcons={false} />
	);
}

function SaveControls({ session }: { session: StoryStateSession }) {
	return (
		<div className='flex shrink-0 items-center gap-3'>
			{!session.autoSave && session.hasChanges && (
				<div className='flex items-center gap-2'>
					<Button
						variant='ghost'
						size='sm'
						className='rounded-full'
						onClick={session.discard}
						disabled={session.isSaving}
					>
						Discard
					</Button>
					<Button
						size='sm'
						className='rounded-full'
						onClick={() => void session.save()}
						disabled={session.isSaving}
					>
						Save
					</Button>
				</div>
			)}
			<button
				type='button'
				role='switch'
				aria-checked={session.autoSave}
				onClick={() => session.setAutoSave(!session.autoSave)}
				className='flex items-center gap-2 rounded-full border px-2 py-0.75 text-xs font-medium hover:bg-secondary'
			>
				<SaveIcon className='size-3.5' strokeWidth={2.25} />
				<span>Auto-save data</span>
				<SwitchIndicator checked={session.autoSave} />
			</button>
		</div>
	);
}
