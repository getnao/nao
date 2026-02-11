import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface Props extends React.ComponentProps<'input'> {
	value: string;
	onSubmit: () => void;
	onEscape: () => void;
	className?: string;
	autoFocus?: boolean;
}

/** Input that takes width and style of parent element */
export const InputEdit = ({ value, onChange, onSubmit, onEscape, className, autoFocus = true, ...rest }: Props) => {
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (inputRef.current && autoFocus) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [autoFocus]);

	return (
		<div
			data-value={value}
			className={cn(
				'inline-grid w-full min-w-px after:invisible after:whitespace-pre after:content-[attr(data-value)] after:[grid-area:1/1] after:text-sm after:p-0 overflow-hidden',
			)}
		>
			<input
				ref={inputRef}
				value={value}
				onChange={onChange}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						onSubmit();
					} else if (e.key === 'Escape') {
						onEscape();
					}
				}}
				onBlur={onSubmit}
				className={cn(
					'min-w-0 bg-transparent text-inherit outline-none border-none [grid-area:1/1] text-sm p-0 focus:outline-none placeholder:font-normal',
					className,
				)}
				{...rest}
			/>
		</div>
	);
};
