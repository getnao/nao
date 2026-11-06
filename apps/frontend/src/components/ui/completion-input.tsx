import { Check } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, ComponentProps, FocusEvent, KeyboardEvent } from 'react';

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
	multiple?: boolean;
	onAccept?: (items: CompletionOption[]) => void;
}

/** A text input suggesting completions for the text at the cursor, accepted with Enter, Tab or a click. */
export function CompletionInput({
	value,
	onValueChange,
	getCompletions,
	multiple = false,
	onAccept,
	onKeyDown,
	onBlur,
	...props
}: CompletionInputProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const listId = useId();
	const [cursor, setCursor] = useState(value.length);
	const [isOpen, setIsOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const [selected, setSelected] = useState<Map<string, CompletionOption>>(new Map());
	const completions = isOpen && getCompletions ? getCompletions(value, cursor) : null;
	const items = completions?.items ?? [];
	const showPopover = isOpen && (items.length > 0 || (multiple && selected.size > 0));
	const active = Math.min(activeIndex, Math.max(items.length - 1, 0));

	useEffect(() => {
		if (items.length > 0) {
			document.getElementById(optionId(listId, active))?.scrollIntoView?.({ block: 'nearest' });
		}
	}, [active, items.length, listId]);

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

	function toggleSelection(item: CompletionOption) {
		setSelected((current) => {
			const next = new Map(current);
			if (next.has(item.insertText)) {
				next.delete(item.insertText);
			} else {
				next.set(item.insertText, item);
			}
			return next;
		});
	}

	function confirmSelection() {
		const chosen = [...selected.values()];
		if (chosen.length === 0) {
			return;
		}
		onAccept?.(chosen);
		setSelected(new Map());
		setIsOpen(false);
	}

	function clearSelection() {
		setSelected(new Map());
	}

	const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
		onValueChange(event.target.value);
		setCursor(event.target.selectionStart ?? event.target.value.length);
		setIsOpen(true);
		setActiveIndex(0);
	};

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (multiple && event.key === 'Enter' && (event.metaKey || event.ctrlKey) && selected.size > 0) {
			event.preventDefault();
			confirmSelection();
			return;
		}
		if (items.length === 0) {
			if (event.key === 'ArrowDown') {
				setIsOpen(true);
				return;
			}
			onKeyDown?.(event);
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			setActiveIndex((active + step + items.length) % items.length);
			return;
		}
		if (multiple) {
			if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
				event.preventDefault();
				const item = items[active];
				if (item) {
					toggleSelection(item);
				}
				return;
			}
			onKeyDown?.(event);
			return;
		}
		const withModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
		if ((event.key === 'Enter' || event.key === 'Tab') && !withModifier) {
			event.preventDefault();
			const item = items[active];
			if (item) {
				accept(item);
			}
			return;
		}
		onKeyDown?.(event);
	}

	function handleBlur(event: FocusEvent<HTMLInputElement>) {
		setIsOpen(false);
		clearSelection();
		onBlur?.(event);
	}

	return (
		<Popover
			open={showPopover}
			onOpenChange={(open) => {
				if (!open) {
					setIsOpen(false);
					clearSelection();
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
					aria-expanded={showPopover}
					aria-controls={showPopover ? listId : undefined}
					aria-activedescendant={items.length > 0 ? optionId(listId, active) : undefined}
					autoComplete='off'
					spellCheck={false}
					onChange={handleChange}
					onKeyDown={handleKeyDown}
					onSelect={(event) => setCursor(event.currentTarget.selectionStart ?? value.length)}
					onFocus={() => setIsOpen(true)}
					onBlur={handleBlur}
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
				<ul
					id={listId}
					role='listbox'
					aria-multiselectable={multiple || undefined}
					className='max-h-64 overflow-y-auto'
				>
					{items.map((item, index) => {
						const isChecked = selected.has(item.insertText);
						return (
							<li
								key={item.label}
								id={optionId(listId, index)}
								role='option'
								aria-selected={multiple ? isChecked : index === active}
								className={cn(
									'flex cursor-pointer items-baseline justify-between gap-4 rounded-sm px-2 py-1.5 text-xs',
									index === active && 'bg-accent text-accent-foreground',
								)}
								onMouseDown={(event) => event.preventDefault()}
								onMouseEnter={() => setActiveIndex(index)}
								onClick={() => (multiple ? toggleSelection(item) : accept(item))}
							>
								<span className='flex min-w-0 items-center gap-1.5'>
									{multiple && (
										<Check
											className={cn('size-3 shrink-0', !isChecked && 'invisible')}
											aria-hidden
										/>
									)}
									<span className='min-w-0 truncate font-mono'>{item.label}</span>
								</span>
								{item.detail && (
									<span className='max-w-[55%] min-w-0 truncate text-muted-foreground'>
										{item.detail}
									</span>
								)}
							</li>
						);
					})}
				</ul>
				{multiple && (
					<button
						type='button'
						disabled={selected.size === 0}
						className='mt-1 flex h-7 w-full items-center justify-center rounded-sm text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-40'
						onMouseDown={(event) => event.preventDefault()}
						onClick={confirmSelection}
					>
						Add
					</button>
				)}
			</PopoverContent>
		</Popover>
	);
}

function optionId(listId: string, index: number): string {
	return `${listId}-option-${index}`;
}
