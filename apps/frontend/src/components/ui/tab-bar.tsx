import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface TabBarItem<Id extends string> {
	id: Id;
	label: ReactNode;
	icon?: ReactNode;
	count?: number;
}

interface TabBarProps<Id extends string> {
	tabs: TabBarItem<Id>[];
	activeTab: Id;
	onTabChange: (id: Id) => void;
	className?: string;
	fitted?: boolean;
}

export function TabBar<Id extends string>({
	tabs,
	activeTab,
	onTabChange,
	className,
	fitted = false,
}: TabBarProps<Id>) {
	return (
		<div className={cn('flex', className)}>
			{tabs.map((tab) => {
				const isActive = activeTab === tab.id;
				return (
					<button
						key={tab.id}
						type='button'
						onClick={() => onTabChange(tab.id)}
						className={cn(
							'-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors',
							fitted && 'w-full justify-center',
							isActive
								? 'border-primary font-medium text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground',
						)}
					>
						{tab.icon}
						<span>{tab.label}</span>
						{tab.count !== undefined && (
							<span className={isActive ? 'text-muted-foreground' : 'text-muted-foreground/60'}>
								{tab.count}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
