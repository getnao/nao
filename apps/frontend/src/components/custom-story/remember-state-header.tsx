import { HistoryIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function RememberStateHeader({ onRemember }: { onRemember: () => void }) {
	return (
		<div className='flex items-center justify-between gap-3 border-b px-4 py-1.5'>
			<span className='truncate text-xs text-muted-foreground'>
				Viewers start this story from scratch on every visit.
			</span>
			<Button variant='outline' size='sm' className='shrink-0 gap-1.5 rounded-full' onClick={onRemember}>
				<HistoryIcon className='size-3.5' />
				Remember state
			</Button>
		</div>
	);
}

export function rememberStatePrompt(title: string, storySlug: string): string {
	return (
		`Make the custom story "${title}" (id "${storySlug}") remember its state between visits: switch the ` +
		'useState calls holding what a viewer would otherwise redo on every visit to useStoryState, keep transient ' +
		'UI in useState, set "autoSave" in nao.json to suit this kind of app, then publish.'
	);
}
