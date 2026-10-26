import { Library } from 'lucide-react';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useSidePanel } from '@/contexts/side-panel';
import { useLibraryItems } from '@/hooks/use-library-items';
import { useOpenLibrary } from '@/hooks/use-open-library';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';
import { cn } from '@/lib/utils';

/** Floating tab pinned to the right edge of the chat; the library side panel slides out from it. */
export function LibraryHandle({ chatId }: { chatId: string }) {
	const { isVisible } = useSidePanel();
	const openLibrary = useOpenLibrary(chatId);
	const chatItemCount = useLibraryItems(chatId).filter((item) => item.section === 'this-chat').length;

	return (
		<div
			className={cn(
				'absolute right-0 top-1/2 z-20 -translate-y-1/2 transition-all duration-200 max-md:hidden',
				isVisible && 'pointer-events-none translate-x-full opacity-0',
			)}
		>
			<SimpleTooltip
				side='left'
				content={
					<span className='flex items-center gap-2'>
						Open My Library
						<kbd className='font-sans text-[10px] opacity-60'>{getShortcutLabel('toggle-story-chat')}</kbd>
					</span>
				}
			>
				<button
					type='button'
					onClick={() => openLibrary()}
					aria-label='Open My Library'
					className='flex cursor-pointer flex-col items-center gap-2 rounded-l-xl border border-r-0 bg-background px-1.5 py-3 text-muted-foreground shadow-sm transition-all hover:pr-2.5 hover:text-foreground'
				>
					<Library className='size-4' strokeWidth={2.25} />
					<span className='rotate-180 text-xs font-medium [writing-mode:vertical-rl]'>My Library</span>
					{chatItemCount > 0 && (
						<span className='rounded-full bg-violet px-1.5 text-[10px] font-semibold tabular-nums text-white'>
							{chatItemCount}
						</span>
					)}
				</button>
			</SimpleTooltip>
		</div>
	);
}
