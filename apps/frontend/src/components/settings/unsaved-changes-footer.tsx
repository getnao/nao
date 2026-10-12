import { Button } from '@/components/ui/button';

interface UnsavedChangesFooterProps {
	isSaving: boolean;
	errorMessage?: string;
	onCancel: () => void;
	onSave: () => void;
}

/** Pinned to the bottom of the settings page; render it as the page's last element so it lines up with the edges. */
export function UnsavedChangesFooter({ isSaving, errorMessage, onCancel, onSave }: UnsavedChangesFooterProps) {
	return (
		<div className='sticky bottom-0 z-10 -mx-4 -mb-6 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-8 md:-mb-8 md:px-8'>
			<div className='flex min-w-0 flex-col'>
				<span className='text-sm text-muted-foreground'>You have unsaved changes.</span>
				{errorMessage && <span className='text-xs text-destructive'>{errorMessage}</span>}
			</div>
			<div className='flex shrink-0 items-center gap-2'>
				<Button variant='outline' className='rounded-full' onClick={onCancel} disabled={isSaving}>
					Cancel
				</Button>
				<Button variant='primary-gradient' className='rounded-full' onClick={onSave} isLoading={isSaving}>
					Save
				</Button>
			</div>
		</div>
	);
}
