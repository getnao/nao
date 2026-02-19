import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import * as React from 'react';
import { ArrowUpIcon, Loader2, Mic, SquareIcon } from 'lucide-react';
import type { VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive cursor-pointer disabled:cursor-default",
	{
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground hover:bg-primary/90',
				destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/15 dark:bg-destructive/60',
				'destructive-soft': 'bg-accent/50 text-destructive hover:bg-destructive/10 dark:bg-destructive/60',
				outline:
					'border bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
				secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
				'ghost-muted':
					'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 text-muted-foreground',
				ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
				link: 'text-primary underline-offset-4 hover:underline',
			},
			size: {
				default: 'h-9 px-4 py-2',
				sm: "h-7 rounded-md gap-2 px-3 [&_svg:not([class*='size-'])]:size-3.5",
				lg: 'h-10 rounded-md px-6',
				icon: 'size-9',
				'icon-xs': 'size-6',
				'icon-sm': "size-7 [&_svg:not([class*='size-'])]:size-3.5",
				'icon-md': 'size-9',
				'icon-lg': 'size-10',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

function Button({
	className,
	variant = 'default',
	size = 'default',
	asChild = false,
	isLoading = false,
	children,
	...props
}: React.ComponentProps<'button'> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
		isLoading?: boolean;
	}): React.ReactNode {
	const Comp = asChild ? Slot : 'button';

	return (
		<Comp
			data-slot='button'
			data-variant={variant}
			data-size={size}
			disabled={isLoading || props.disabled}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		>
			{isLoading ? (
				<>
					<Loader2 className='size-4 animate-spin' />
					{children}
				</>
			) : (
				children
			)}
		</Comp>
	);
}

function ButtonConnection({ children }: React.ComponentProps<'button'>) {
	return (
		<button
			type='submit'
			className='flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background hover:bg-accent hover:text-accent-foreground transition-colors duration-200 shadow-sm hover:shadow-md'
		>
			{children}
		</button>
	);
}

function ChatSendButton({ isRunning, disabled, ...props }: React.ComponentProps<'button'> & { isRunning: boolean }) {
	disabled = !isRunning && disabled;

	return (
		<Button
			{...props}
			disabled={disabled}
			size='icon-sm'
			className={cn(
				'rounded-full ml-auto disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 size-7',
			)}
		>
			{isRunning ? (
				<SquareIcon fill='currentColor' stroke='currentColor' className='size-3' />
			) : (
				<ArrowUpIcon className='size-4' />
			)}
		</Button>
	);
}

function MicButton({
	state,
	onClick,
	disabled,
}: {
	state: 'idle' | 'recording' | 'transcribing';
	onClick: () => void;
	disabled?: boolean;
}) {
	const isRecording = state === 'recording';
	const isTranscribing = state === 'transcribing';

	return (
		<button
			type='button'
			onClick={onClick}
			disabled={disabled || isTranscribing}
			aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
			className={`
				inline-flex items-center justify-center rounded-full size-7 transition-all cursor-pointer
				disabled:pointer-events-none disabled:opacity-50
				${isRecording ? 'bg-violet/30 animate-pulse' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}
			`}
		>
			{isTranscribing ? <Loader2 className='size-3.5 animate-spin' /> : <Mic className='size-3.5' />}
		</button>
	);
}

export { Button, ButtonConnection, ChatSendButton as ChatButton, MicButton };
