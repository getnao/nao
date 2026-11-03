import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, ComponentProps, KeyboardEvent } from 'react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface CompletionOption {
	label: string;
	detail?: string;
	insertText: string;
}

/** Options for the text being typed; accepting one replaces `value.slice(from, to)` with its `insertText`. */
export interface CompletionOptions {
	from: number;
	to: number;
	items: CompletionOption[];
}

interface CompletionInputProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange'> {
	value: string;
	onValueChange: (value: string) => void;
	getCompletions?: (value: string, cursor: number) => CompletionOptions;
}

/** A text input suggesting completions for the text at the cursor, accepted with Enter, Tab or a click. */
export function CompletionInput({ value, onValueChange, getCompletions, ...props }: CompletionInputProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const listId = useId();
	const [cursor, setCursor] = useState(value.length);
	const [isOpen, setIsOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const completions = isOpen && getCompletions ? getCompletions(value, cursor) : null;
	const items = completions?.items ?? [];
	const isShowingItems = items.length > 0;
	const active = Math.min(activeIndex, items.length - 1);

	useEffect(() => {
		if (isShowingItems) {
			document.getElementById(optionId(listId, active))?.scrollIntoView?.({ block: 'nearest' });
		}
	}, [active, isShowingItems, listId]);

	const accept = (item: CompletionOption) => {
		if (!completions) {
			return;
		}
		const nextValue = value.slice(0, completions.from) + item.insertText + value.slice(completions.to);
		const nextCursor = completions.from + item.insertText.length;
		onValueChange(nextValue);
		setCursor(nextCursor);
		setIsOpen(false);
		requestAnimationFrame(() => inputRef.current?.setSelectionRange(nextCursor, nextCursor));
	};

	const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
		onValueChange(event.target.value);
		setCursor(event.target.selectionStart ?? event.target.value.length);
		setIsOpen(true);
		setActiveIndex(0);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isShowingItems) {
			if (event.key === 'ArrowDown') {
				setIsOpen(true);
			}
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			setActiveIndex((active + step + items.length) % items.length);
			return;
		}
		const withModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
		if ((event.key === 'Enter' || event.key === 'Tab') && !withModifier) {
			event.preventDefault();
			accept(items[active]);
		}
	};

	return (
		<Popover
			open={isShowingItems}
			onOpenChange={(open) => {
				if (!open) {
					setIsOpen(false);
				}
			}}
		>
			<PopoverAnchor asChild>
				<Input
					{...props}
					ref={inputRef}
					value={value}
					role='combobox'
					aria-autocomplete='list'
					aria-expanded={isShowingItems}
					aria-controls={isShowingItems ? listId : undefined}
					aria-activedescendant={isShowingItems ? optionId(listId, active) : undefined}
					autoComplete='off'
					spellCheck={false}
					onChange={handleChange}
					onKeyDown={handleKeyDown}
					onSelect={(event) => setCursor(event.currentTarget.selectionStart ?? value.length)}
					onFocus={() => setIsOpen(true)}
					onBlur={() => setIsOpen(false)}
				/>
			</PopoverAnchor>
			<PopoverContent
				align='start'
				className='w-auto max-w-md min-w-(--radix-popover-trigger-width) p-1'
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
				onInteractOutside={(event) => {
					if (event.target === inputRef.current) {
						event.preventDefault();
					}
				}}
			>
				<ul id={listId} role='listbox' className='max-h-64 overflow-y-auto'>
					{items.map((item, index) => (
						<li
							key={item.label}
							id={optionId(listId, index)}
							role='option'
							aria-selected={index === active}
							className={cn(
								'flex cursor-pointer items-baseline justify-between gap-4 rounded-sm px-2 py-1.5 text-xs',
								index === active && 'bg-accent text-accent-foreground',
							)}
							onMouseDown={(event) => event.preventDefault()}
							onMouseEnter={() => setActiveIndex(index)}
							onClick={() => accept(item)}
						>
							<span className='min-w-0 truncate font-mono'>{item.label}</span>
							{item.detail && (
								<span className='max-w-[55%] min-w-0 truncate text-muted-foreground'>
									{item.detail}
								</span>
							)}
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	);
}

function optionId(listId: string, index: number): string {
	return `${listId}-option-${index}`;
}
