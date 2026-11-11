import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBackToApp } from '@/hooks/use-last-app-location';
import { cn, hideIf } from '@/lib/utils';

const BACK_TO_APP_LABEL = 'Back to app';

export function SidebarBackToApp({ isCollapsed }: { isCollapsed: boolean }) {
	const { href, goBack } = useBackToApp();
	const [isTooltipOpen, setIsTooltipOpen] = useState(false);

	const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
		if (isModifiedClick(event)) {
			return;
		}
		event.preventDefault();
		goBack();
	};

	return (
		<Tooltip open={isCollapsed && isTooltipOpen} onOpenChange={setIsTooltipOpen}>
			<TooltipTrigger asChild>
				<Button
					asChild
					variant='ghost'
					className={cn(
						'w-full justify-start group shadow-none transition-[padding,height,background-color] duration-300 p-[10px_!important] gap-4',
						isCollapsed ? 'h-9' : '',
					)}
				>
					<a href={href} onClick={handleClick} aria-label={BACK_TO_APP_LABEL}>
						<ArrowLeft className='size-4 transition-transform will-change-transform group-hover:-translate-x-0.5' />
						<span className={cn('transition-[opacity,visibility] duration-300', hideIf(isCollapsed))}>
							{BACK_TO_APP_LABEL}
						</span>
					</a>
				</Button>
			</TooltipTrigger>
			<TooltipContent side='right'>{BACK_TO_APP_LABEL}</TooltipContent>
		</Tooltip>
	);
}

function isModifiedClick(event: React.MouseEvent) {
	return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}
