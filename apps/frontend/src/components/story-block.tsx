import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface StoryContainerProps {
	children: ReactNode;
	className?: string;
}

export function StoryBlock({ children, className }: StoryContainerProps) {
	return <div className={cn('story-block', className)}>{children}</div>;
}

export function StoryTableFrame({ children, className }: StoryContainerProps) {
	return <div className={cn('story-table', className)}>{children}</div>;
}
