import * as React from 'react';
import { Link as RouterLink } from '@tanstack/react-router';
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import type { LinkProps } from '@tanstack/react-router';

interface CustomLinkProps extends LinkProps {
	className?: string;
	onDoubleClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

export const Link = forwardRef<HTMLAnchorElement, CustomLinkProps>(({ className, onDoubleClick, ...props }, ref) => {
	return (
		<RouterLink ref={ref} {...props} className={cn('text-foreground', className)} onDoubleClick={onDoubleClick} />
	);
});

Link.displayName = 'Link';
