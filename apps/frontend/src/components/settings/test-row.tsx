import { TESTS_FOLDER, toExplorerTestPath } from '@nao/shared/test-paths';

import type { ReactNode } from 'react';

export function TestRow({
	leading,
	icon,
	name,
	path,
	detail,
	onOpen,
}: {
	leading?: ReactNode;
	icon: ReactNode;
	name: string;
	path: string;
	detail: ReactNode;
	onOpen: (explorerPath: string) => void;
}) {
	return (
		<li className='flex items-center border-b'>
			{leading && <span className='flex shrink-0 items-center pl-3'>{leading}</span>}
			<button
				type='button'
				onClick={() => onOpen(toExplorerTestPath(path))}
				className='flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-accent/50'
				title='Open this test'
			>
				{icon}
				<span className='flex min-w-0 flex-1 flex-col'>
					<span className='truncate font-medium text-foreground'>{name}</span>
					<span className='truncate font-mono text-[11px] text-muted-foreground'>
						{TESTS_FOLDER}/{path}
					</span>
				</span>
				<span className='flex min-w-0 shrink-0 items-center'>{detail}</span>
			</button>
		</li>
	);
}
