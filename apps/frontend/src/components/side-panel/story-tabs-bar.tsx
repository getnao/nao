import { Fragment, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { DragEvent, KeyboardEvent } from 'react';

import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface StoryTabsBarProps {
	tabs: Array<{ title: string }>;
	activeIndex: number;
	onSelect: (index: number) => void;
	editable?: {
		onRename: (index: number, title: string) => void;
		onDelete: (index: number) => void;
		onMove: (fromIndex: number, toIndex: number) => void;
		onAdd: () => void;
	};
	contentClassName?: string;
}

export function StoryTabsBar({ tabs, activeIndex, onSelect, editable, contentClassName }: StoryTabsBarProps) {
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [editingTitle, setEditingTitle] = useState('');
	const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
	const [dropSlot, setDropSlot] = useState<number | null>(null);
	const dragIndexRef = useRef<number | null>(null);
	const dropSlotRef = useRef<number | null>(null);

	const startRenaming = (index: number) => {
		setEditingIndex(index);
		setEditingTitle(tabs[index].title);
	};

	const finishRenaming = () => {
		if (editingIndex === null) {
			return;
		}
		const title = editingTitle.trim();
		if (title && title !== tabs[editingIndex].title) {
			editable?.onRename(editingIndex, title);
		}
		setEditingIndex(null);
	};

	const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			finishRenaming();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			setEditingIndex(null);
		}
	};

	const handleDragStart = (event: DragEvent<HTMLDivElement>, index: number) => {
		dragIndexRef.current = index;
		setDraggingIndex(index);
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/plain', String(index));
	};

	const handleDragOver = (event: DragEvent<HTMLDivElement>, index: number) => {
		if (!editable || dragIndexRef.current === null) {
			return;
		}

		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		const bounds = event.currentTarget.getBoundingClientRect();
		const slot = event.clientX < bounds.left + bounds.width / 2 ? index : index + 1;
		dropSlotRef.current = slot;
		setDropSlot(slot);
	};

	const handleDrop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		const fromIndex = dragIndexRef.current;
		const slot = dropSlotRef.current;
		if (fromIndex !== null && slot !== null) {
			const toIndex = slot > fromIndex ? slot - 1 : slot;
			if (toIndex !== fromIndex) {
				editable?.onMove(fromIndex, toIndex);
			}
		}
		clearDragState();
	};

	const clearDragState = () => {
		dragIndexRef.current = null;
		dropSlotRef.current = null;
		setDraggingIndex(null);
		setDropSlot(null);
	};

	return (
		<div
			className='relative w-full bg-muted/30'
			onDrop={handleDrop}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					clearDragState();
				}
			}}
		>
			<div className='pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border' />
			<div
				className={cn(
					'flex min-h-10 items-end gap-1 overflow-x-auto pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
					contentClassName,
				)}
			>
				{tabs.map((tab, index) => (
					<Fragment key={`${index}-${tab.title}`}>
						{dropSlot === index && (
							<div className='pointer-events-none h-9 w-[3px] shrink-0 self-center rounded-full bg-primary shadow-[0_0_6px] shadow-primary/40' />
						)}
						<div
							draggable={Boolean(editable) && editingIndex !== index}
							onDragStart={(event) => handleDragStart(event, index)}
							onDragEnd={clearDragState}
							onDragOver={(event) => handleDragOver(event, index)}
							className={cn(
								'group/tab flex h-9 shrink-0 cursor-pointer items-center rounded-t-md border border-transparent transition-[color,background-color,transform,opacity]',
								index === activeIndex
									? 'relative z-10 border-border border-b-0 bg-background text-foreground'
									: 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
								draggingIndex === index && 'scale-95 opacity-40',
							)}
						>
							{editingIndex === index ? (
								<Input
									autoFocus
									value={editingTitle}
									onChange={(event) => setEditingTitle(event.target.value)}
									onBlur={finishRenaming}
									onKeyDown={handleRenameKeyDown}
									className='mx-1 h-7 w-32 px-2 text-sm'
								/>
							) : (
								<button
									type='button'
									onClick={() => onSelect(index)}
									onDoubleClick={() => editable && startRenaming(index)}
									className={cn(
										'h-full max-w-48 cursor-pointer truncate pl-3 text-sm font-medium outline-none',
										editable ? 'pr-1' : 'pr-3',
									)}
								>
									{tab.title || 'Untitled'}
								</button>
							)}

							{editable && editingIndex !== index && (
								<div className='mr-1 flex items-center opacity-0 transition-opacity group-hover/tab:opacity-100 group-focus-within/tab:opacity-100'>
									<Dialog>
										<DialogTrigger asChild>
											<Button
												type='button'
												variant='ghost'
												size='icon-xs'
												aria-label={`Delete ${tab.title || 'tab'}`}
											>
												<X />
											</Button>
										</DialogTrigger>
										<DialogContent>
											<DialogHeader>
												<DialogTitle>Delete this tab?</DialogTitle>
											</DialogHeader>
											<p className='text-sm text-muted-foreground'>
												The tab and all of its content will be removed.
											</p>
											<div className='flex justify-end gap-2'>
												<DialogClose asChild>
													<Button variant='outline' className='rounded-full border'>
														Cancel
													</Button>
												</DialogClose>
												<DialogClose asChild>
													<Button
														variant='destructive'
														className='rounded-full'
														onClick={() => editable.onDelete(index)}
													>
														Delete
													</Button>
												</DialogClose>
											</div>
										</DialogContent>
									</Dialog>
								</div>
							)}
						</div>
					</Fragment>
				))}

				{dropSlot === tabs.length && (
					<div className='pointer-events-none h-9 w-[3px] shrink-0 self-center rounded-full bg-primary shadow-[0_0_6px] shadow-primary/40' />
				)}

				{editable && (
					<Button
						type='button'
						variant='ghost'
						size='icon-xs'
						aria-label='Add tab'
						onClick={editable.onAdd}
						className='shrink-0 self-center'
					>
						<Plus />
					</Button>
				)}
			</div>
		</div>
	);
}
