import type { IconSegmentedToggleOption } from '@/components/ui/icon-segmented-toggle';

import type { StoryStateSession, StoryStateView } from './use-story-state-session';
import { IconSegmentedToggle } from '@/components/ui/icon-segmented-toggle';

/** Lets a viewer who is not the owner switch between their own view and the owner's. */
export function StoryStateHeader({ session }: { session: StoryStateSession }) {
	const { snapshot } = session;
	if (!snapshot || snapshot.isOwner) {
		return null;
	}

	return (
		<div className='flex items-center justify-between gap-3 border-b px-4 py-1.5'>
			<ViewToggle view={session.view} ownerName={snapshot.ownerName} onViewChange={session.setView} />
			{session.view === 'shared' && (
				<span className='text-xs text-muted-foreground'>Changes here are not saved</span>
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
