import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { SHORTCUTS } from '@/lib/keyboard-shortcuts';

type KeyboardShortcutsDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
	const groups = Array.from(new Set(SHORTCUTS.map((entry) => entry.group)));

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
					<DialogDescription className='sr-only'>
						List of available keyboard shortcuts and their key combinations.
					</DialogDescription>
				</DialogHeader>
				<div className='space-y-5'>
					{groups.map((group) => (
						<section key={group} className='space-y-2'>
							<h3 className='text-xs font-medium text-muted-foreground'>{group}</h3>
							<div className='space-y-1'>
								{SHORTCUTS.filter((entry) => entry.group === group).map((entry) => (
									<div
										key={entry.id}
										className='flex items-center justify-between gap-4 py-1 text-sm'
									>
										<span>{entry.label}</span>
										<div className='flex items-center gap-1.5'>
											<Kbd shortcut={entry.shortcut} />
											{entry.alternateShortcuts?.map((shortcut, index) => (
												<span
													key={`${entry.id}-alternate-${index}`}
													className='flex items-center gap-1.5'
												>
													<span className='text-muted-foreground'>·</span>
													<Kbd shortcut={shortcut} />
												</span>
											))}
										</div>
									</div>
								))}
							</div>
						</section>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
