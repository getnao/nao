import type { ReactNode } from 'react';

interface MCPAppHeaderProps {
	title: string;
	children?: ReactNode;
}

export function McpAppHeader({ title, children }: MCPAppHeaderProps) {
	return (
		<header className='flex shrink-0 items-center gap-3 border-b bg-background px-4 py-3 md:px-6 md:py-4 min-w-0'>
			<h1 className='min-w-0 flex-1 truncate text-base font-medium'>{title}</h1>
			{children ? <div className='ml-auto flex shrink-0 items-center gap-1.5'>{children}</div> : null}
		</header>
	);
}
