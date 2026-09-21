import type { HTMLAttributes } from 'react';
import type { Shortcut } from '@/lib/platform';

import { formatShortcut } from '@/lib/platform';
import { cn } from '@/lib/utils';

type KbdProps = HTMLAttributes<HTMLSpanElement> & {
	shortcut?: Shortcut;
	keys?: string[];
};

export function Kbd({ shortcut, keys, className, ...props }: KbdProps) {
	const tokens = keys ?? (shortcut ? formatShortcut(shortcut) : []);

	return (
		<span className={cn('inline-flex items-center gap-0.5', className)} {...props}>
			{tokens.map((token, index) => (
				<kbd
					key={`${token}-${index}`}
					className='rounded border bg-muted/50 px-1 py-0.5 font-sans text-[10px] leading-none text-muted-foreground'
				>
					{token}
				</kbd>
			))}
		</span>
	);
}
