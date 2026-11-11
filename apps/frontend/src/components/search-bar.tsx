import { Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { Kbd } from '@/components/ui/kbd';
import { isTypingTarget } from '@/lib/keyboard-shortcuts';
import { cn } from '@/lib/utils';

export function SearchBar({
	value,
	onChange,
	placeholder,
	ariaLabel,
	className,
	size = 'default',
	focusShortcutKey,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	ariaLabel: string;
	className?: string;
	size?: 'default' | 'lg';
	focusShortcutKey?: string;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	useFocusShortcut(inputRef, focusShortcutKey);

	function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
		if (event.key === 'Escape') {
			if (value) {
				onChange('');
			} else {
				inputRef.current?.blur();
			}
		}
	}

	return (
		<div
			className={cn(
				'group/search flex items-center gap-2 rounded-full border w-full focus-within:border-foreground/40 transition-colors',
				size === 'lg' ? 'h-9 px-3.5' : 'h-8 px-3 max-w-sm',
				className,
			)}
		>
			<Search className='size-4 text-muted-foreground shrink-0' />
			<input
				ref={inputRef}
				type='text'
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={placeholder}
				aria-label={ariaLabel}
				className='flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
			/>
			{value ? (
				<button
					type='button'
					onClick={() => onChange('')}
					aria-label='Clear search'
					className='text-muted-foreground hover:text-foreground shrink-0'
				>
					<X className='size-4' />
				</button>
			) : (
				focusShortcutKey && (
					<Kbd keys={[focusShortcutKey]} className='shrink-0 group-focus-within/search:hidden' />
				)
			)}
		</div>
	);
}

function useFocusShortcut(inputRef: RefObject<HTMLInputElement | null>, shortcutKey: string | undefined) {
	useEffect(() => {
		if (!shortcutKey) {
			return;
		}
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key !== shortcutKey || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event)) {
				return;
			}
			event.preventDefault();
			inputRef.current?.focus();
		}
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [inputRef, shortcutKey]);
}
