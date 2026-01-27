import React, { useEffect, useRef } from 'react';

/** Input that takes width and style of parent element */
export const InputEdit = (
	props: {
		value: string;
		onSubmit: () => void;
		onEscape: () => void;
	} & React.ComponentProps<'input'>,
) => {
	const { value, onChange, onSubmit, onEscape, ...rest } = props;
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, []);

	return (
		<div
			data-value={value}
			className='inline-grid  w-full min-w-px after:invisible after:whitespace-pre after:content-[attr(data-value)] after:[grid-area:1/1] after:text-sm after:p-0 overflow-hidden'
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
				className='min-w-0 bg-transparent text-inherit outline-none border-none [grid-area:1/1] text-sm p-0 focus:outline-none'
				{...rest}
			/>
		</div>
	);
};
