import { Pencil, RefreshCw } from 'lucide-react';

import type { StoryEditPresence } from '@/hooks/use-story-edit-session';

/** Tells who is editing the story right now, or who just saved the version on screen. */
export function StoryEditPresenceBanner({ presence }: { presence: StoryEditPresence }) {
	if (presence.isLockedByOthers) {
		return (
			<PresenceLine icon={<Pencil className='size-3 shrink-0' strokeWidth={2.25} />}>
				{describeLockHolder(presence)}
			</PresenceLine>
		);
	}
	if (presence.updatedByName) {
		return (
			<PresenceLine icon={<RefreshCw className='size-3 shrink-0' strokeWidth={2.25} />}>
				{`Updated by ${presence.updatedByName}.`}
			</PresenceLine>
		);
	}
	return null;
}

function describeLockHolder(presence: StoryEditPresence): string {
	if (presence.otherEditorName) {
		return `${presence.otherEditorName} is editing this story. You can edit it once they are done.`;
	}
	if (presence.ownEditElsewhere === 'tab') {
		return 'You are editing this story in another tab. You can edit it here once that is done.';
	}
	return 'You are editing this story in another chat. You can edit it here once that is done.';
}

function PresenceLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
	return (
		<div
			role='status'
			className='flex items-center gap-1.5 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground md:px-6'
		>
			{icon}
			<span>{children}</span>
		</div>
	);
}
