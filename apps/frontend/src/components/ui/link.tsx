import { Link as RouterLink } from '@tanstack/react-router';
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import type { LinkProps } from '@tanstack/react-router';

interface CustomLinkProps extends LinkProps {
	className?: string;
}

export const Link = forwardRef<HTMLAnchorElement, CustomLinkProps>(
	({ className, ...props }, ref) => {
		return (
			<RouterLink
				ref={ref}
				{...props}
				className={cn(
					'text-foreground hover:text-foreground/80 transition-colors',
					className,
				)}
			/>
		);
	},
);

Link.displayName = 'Link';
