import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
	return <SelectPrimitive.Root data-slot='select' {...props} />;
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
	return <SelectPrimitive.Group data-slot='select-group' {...props} />;
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
	return <SelectPrimitive.Value data-slot='select-value' {...props} />;
}

function SelectTrigger({
	className,
	size = 'default',
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
	size?: 'sm' | 'default';
}) {
	return (
		<SelectPrimitive.Trigger
			data-slot='select-trigger'
			data-size={size}
			className={cn(
				// Layout
				'flex w-fit items-center justify-between gap-1',
				// Sizing
				'px-2.5 py-1 data-[size=default]:h-8 data-[size=sm]:h-6',
				// Typography
				'text-sm whitespace-nowrap',
				// Border & background
				'rounded-lg border border-input bg-transparent',
				'dark:bg-input/30 dark:hover:bg-input/50',
				// Focus states
				'outline-none transition-[color,box-shadow] cursor-pointer',
				// Invalid states
				'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
				'dark:aria-invalid:ring-destructive/40',
				// Disabled state
				'disabled:cursor-not-allowed disabled:opacity-50',
				// Placeholder styling
				'data-placeholder:text-muted-foreground',
				// Select value slot styling
				'*:data-[slot=select-value]:line-clamp-1',
				'*:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2',
				// SVG styling
				'[&_svg]:pointer-events-none [&_svg]:shrink-0',
				"[&_svg:not([class*='size-'])]:size-4",
				"[&_svg:not([class*='text-'])]:text-muted-foreground",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDownIcon className='size-4 opacity-50' />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectContent({
	className,
	children,
	position = 'item-aligned',
	align = 'center',
	...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				data-slot='select-content'
				className={cn(
					// Layout & positioning
					'relative z-50',
					'origin-(--radix-select-content-transform-origin)',
					// Sizing
					'max-h-(--radix-select-content-available-height) min-w-32',
					// Overflow
					'overflow-x-hidden overflow-y-auto',
					// Colors
					'bg-popover text-popover-foreground',
					// Border & shadow
					'rounded-lg border shadow-lg',
					// Open/close animations
					'data-[state=open]:animate-in data-[state=closed]:animate-out',
					'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
					'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
					// Slide-in animations based on side
					'data-[side=bottom]:slide-in-from-top-2',
					'data-[side=left]:slide-in-from-right-2',
					'data-[side=right]:slide-in-from-left-2',
					'data-[side=top]:slide-in-from-bottom-2',
					// Popper position translations
					position === 'popper' &&
						cn(
							'data-[side=bottom]:translate-y-1',
							'data-[side=left]:-translate-x-1',
							'data-[side=right]:translate-x-1',
							'data-[side=top]:-translate-y-1',
						),
					className,
				)}
				position={position}
				align={align}
				{...props}
			>
				<SelectScrollUpButton />
				<SelectPrimitive.Viewport
					className={cn(
						'p-1',
						position === 'popper' &&
							cn(
								'h-(--radix-select-trigger-height)',
								'w-full min-w-(--radix-select-trigger-width)',
								'scroll-my-1',
							),
					)}
				>
					{children}
				</SelectPrimitive.Viewport>
				<SelectScrollDownButton />
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
	return (
		<SelectPrimitive.Label
			data-slot='select-label'
			className={cn(
				// Spacing
				'px-2 py-1.5',
				// Typography
				'text-sm text-muted-foreground',
				className,
			)}
			{...props}
		/>
	);
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
	return (
		<SelectPrimitive.Item
			data-slot='select-item'
			className={cn(
				// Layout
				'relative flex w-full items-center gap-2',
				// Sizing & spacing
				'py-1 pr-8 pl-2 not-last:mb-[2px]',
				// Typography
				'text-sm',
				// Border & shape
				'rounded-sm',
				// Interaction
				'cursor-pointer select-none outline-hidden',
				// Focus state
				'focus:bg-accent focus:text-accent-foreground',
				// Disabled state
				'data-disabled:pointer-events-none data-disabled:opacity-50',
				// Last span styling (for icons with text)
				'*:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2',
				// SVG styling
				'[&_svg]:pointer-events-none [&_svg]:shrink-0',
				"[&_svg:not([class*='size-'])]:size-4",
				"[&_svg:not([class*='text-'])]:text-muted-foreground",
				className,
			)}
			{...props}
		>
			<span
				data-slot='select-item-indicator'
				className='absolute right-2 flex size-3.5 items-center justify-center'
			>
				<SelectPrimitive.ItemIndicator>
					<CheckIcon className='size-4' />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
	return (
		<SelectPrimitive.Separator
			data-slot='select-separator'
			className={cn(
				// Sizing
				'h-px -mx-1 my-1',
				// Colors
				'bg-border',
				// Interaction
				'pointer-events-none',
				className,
			)}
			{...props}
		/>
	);
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
	return (
		<SelectPrimitive.ScrollUpButton
			data-slot='select-scroll-up-button'
			className={cn(
				// Layout
				'flex items-center justify-center',
				// Spacing
				'py-1',
				// Interaction
				'cursor-default',
				className,
			)}
			{...props}
		>
			<ChevronUpIcon className='size-4' />
		</SelectPrimitive.ScrollUpButton>
	);
}

function SelectScrollDownButton({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
	return (
		<SelectPrimitive.ScrollDownButton
			data-slot='select-scroll-down-button'
			className={cn(
				// Layout
				'flex items-center justify-center',
				// Spacing
				'py-1',
				// Interaction
				'cursor-default',
				className,
			)}
			{...props}
		>
			<ChevronDownIcon className='size-4' />
		</SelectPrimitive.ScrollDownButton>
	);
}

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
};
