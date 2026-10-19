import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBackToApp } from '@/hooks/use-last-app-location';
import { getShortcut, getShortcutLabel, isTypingTarget } from '@/lib/keyboard-shortcuts';
import { matchesShortcut } from '@/lib/platform';
import { cn, hideIf } from '@/lib/utils';

const BACK_TO_APP_LABEL = 'Back to app';

export function SidebarBackToApp({ isCollapsed }: { isCollapsed: boolean }) {
	const { href, goBack } = useBackToApp();
	const [isTooltipOpen, setIsTooltipOpen] = useState(false);
	const shortcutLabel = getShortcutLabel('back-to-app');
	useBackToAppShortcut(goBack);

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
						<ArrowLeft className='size-4 transition-transform group-hover:-translate-x-0.5' />
						<span
							className={cn(
								'flex flex-1 items-center transition-[opacity,visibility] duration-300',
								hideIf(isCollapsed),
							)}
						>
							<span>{BACK_TO_APP_LABEL}</span>
							<kbd className='ml-auto rounded border border-border px-1 font-sans text-[10px] font-normal text-muted-foreground'>
								{shortcutLabel}
							</kbd>
						</span>
					</a>
				</Button>
			</TooltipTrigger>
			<TooltipContent side='right'>
				<span className='flex items-center gap-2'>
					{BACK_TO_APP_LABEL}
					<kbd className='text-[10px] opacity-60 font-sans'>{shortcutLabel}</kbd>
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

/** Escape leaves settings, unless an open dialog, menu or input already handled the key. */
function useBackToAppShortcut(onBack: () => void) {
	useEffect(() => {
		const { shortcut } = getShortcut('back-to-app');
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.repeat || isTypingTarget(event)) {
				return;
			}
			if (matchesShortcut(event, shortcut)) {
				onBack();
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [onBack]);
}

function isModifiedClick(event: React.MouseEvent) {
	return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}
