import { TESTS_FOLDER, toExplorerTestPath } from '@nao/shared/test-paths';

import type { ReactNode } from 'react';

export function TestRow({
	leading,
	icon,
	name,
	path,
	meta,
	detail,
	onOpen,
}: {
	leading?: ReactNode;
	icon: ReactNode;
	name: string;
	path: string;
	/** Shown after the path, like the owner and the tags of the test. */
	meta?: ReactNode;
	detail: ReactNode;
	onOpen: (explorerPath: string) => void;
}) {
	return (
		<li className='flex items-center border-b transition-colors hover:bg-accent/50'>
			{leading && <span className='flex shrink-0 items-center pl-3'>{leading}</span>}
			<button
				type='button'
				onClick={() => onOpen(toExplorerTestPath(path))}
				className='flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left'
				title='Open this test'
			>
				{icon}
				<span className='flex min-w-0 flex-1 flex-col'>
					<span className='truncate font-medium text-foreground'>{name}</span>
					<span className='flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground'>
						<span className='truncate font-mono'>
							{TESTS_FOLDER}/{path}
						</span>
						{meta}
					</span>
				</span>
				<span className='flex min-w-0 shrink-0 items-center'>{detail}</span>
			</button>
		</li>
	);
}
