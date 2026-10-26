import { useState } from 'react';
import { AtSign, ChevronRight, Library, X } from 'lucide-react';
import { LibraryBrowser } from './library-browser';
import { LibraryItemIcon } from './library-item-icon';
import { LibraryItemViewer } from './library-item-viewer';
import type { LibraryFilters, LibraryItem } from '@/lib/library';
import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useSidePanel } from '@/contexts/side-panel';
import { useLibraryItems } from '@/hooks/use-library-items';
import { LIBRARY_TYPE_LABELS, toLibraryMention } from '@/lib/library';
import { libraryLastItemStore, libraryMentionRequestStore } from '@/stores/library';

const DEFAULT_FILTERS: LibraryFilters = { search: '', type: 'all' };

/** Side panel listing every story, query, file and chat the user can reach, with the selected one opened in place. */
export function LibraryPanel({ chatId }: { chatId: string }) {
	const items = useLibraryItems(chatId);
	const { close, setCurrentStorySlug } = useSidePanel();
	const [activeItemId, setActiveItemId] = useState(() => libraryLastItemStore.get(chatId));
	const [filters, setFilters] = useState(DEFAULT_FILTERS);
	const activeItem = items.find((item) => item.id === activeItemId);

	const openItem = (item: LibraryItem) => {
		setActiveItemId(item.id);
		libraryLastItemStore.set(chatId, item.id);
	};
	const backToLibrary = () => {
		setActiveItemId(null);
		setCurrentStorySlug(null);
		libraryLastItemStore.set(chatId, null);
	};
	const mentionItem = (item: LibraryItem) => libraryMentionRequestStore.request(toLibraryMention(item));

	return (
		<div className='flex h-full min-h-0 flex-col bg-background'>
			<LibraryPanelHeader
				activeItem={activeItem}
				onBackToLibrary={backToLibrary}
				onMentionItem={mentionItem}
				onClose={close}
			/>
			{activeItem ? (
				<div className='min-h-0 flex-1'>
					<LibraryItemViewer key={activeItem.id} chatId={chatId} item={activeItem} />
				</div>
			) : (
				<LibraryBrowser
					items={items}
					filters={filters}
					onFiltersChange={setFilters}
					onOpenItem={openItem}
					onMentionItem={mentionItem}
				/>
			)}
		</div>
	);
}

interface LibraryPanelHeaderProps {
	activeItem: LibraryItem | undefined;
	onBackToLibrary: () => void;
	onMentionItem: (item: LibraryItem) => void;
	onClose: () => void;
}

function LibraryPanelHeader({ activeItem, onBackToLibrary, onMentionItem, onClose }: LibraryPanelHeaderProps) {
	return (
		<div className='flex h-12 shrink-0 items-center gap-2 border-b px-3'>
			<nav aria-label='Breadcrumb' className='flex min-w-0 flex-1 items-center gap-1 text-sm'>
				{activeItem ? (
					<button
						type='button'
						onClick={onBackToLibrary}
						className='flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground'
					>
						<Library className='size-3.5' strokeWidth={2.25} />
						<span>My Library</span>
					</button>
				) : (
					<span className='flex items-center gap-1.5 px-1.5 py-1 font-semibold'>
						<Library className='size-3.5' strokeWidth={2.25} />
						<span>My Library</span>
					</span>
				)}
				{activeItem && (
					<>
						<ChevronRight className='size-3.5 shrink-0 text-muted-foreground' />
						<span className='flex min-w-0 items-center gap-1.5 px-1 font-semibold' aria-current='page'>
							<LibraryItemIcon item={activeItem} className='size-3.5 shrink-0' />
							<span className='truncate' title={activeItem.name}>
								{activeItem.name}
							</span>
							<span className='shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'>
								{LIBRARY_TYPE_LABELS[activeItem.type].singular}
							</span>
						</span>
					</>
				)}
			</nav>
			{activeItem && (
				<SimpleTooltip content='Mention in chat'>
					<Button
						variant='ghost'
						size='icon-sm'
						className='hover:rounded-full'
						onClick={() => onMentionItem(activeItem)}
						aria-label='Mention in chat'
					>
						<AtSign className='size-3.5' />
					</Button>
				</SimpleTooltip>
			)}
			<Button variant='ghost' size='icon-sm' className='hover:rounded-full' onClick={onClose} aria-label='Close'>
				<X className='size-3.5' strokeWidth={2.25} />
			</Button>
		</div>
	);
}
