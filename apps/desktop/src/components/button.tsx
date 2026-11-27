import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'destructive';

const BASE_CLASSES =
	'inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet/50 disabled:cursor-default disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
	primary: 'text-white bg-brand-gradient hover:bg-brand-gradient-hover',
	outline: 'border border-border bg-card hover:bg-accent',
	ghost: 'hover:bg-accent text-muted-foreground hover:text-foreground',
	destructive: 'text-destructive hover:bg-destructive/10',
};

export function Button({
	className,
	variant = 'primary',
	isLoading = false,
	disabled,
	children,
	...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; isLoading?: boolean }) {
	return (
		<button
			type='button'
			disabled={disabled || isLoading}
			className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], className)}
			{...props}
		>
			{isLoading && <Loader2 className='animate-spin' />}
			{children}
		</button>
	);
}

/** Opens in the system browser: the app routes new-window requests there. */
export function ExternalLinkButton({
	className,
	variant = 'outline',
	...props
}: ComponentProps<'a'> & { variant?: ButtonVariant }) {
	return (
		<a
			target='_blank'
			rel='noreferrer'
			className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], className)}
			{...props}
		/>
	);
}
