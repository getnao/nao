import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface TabBarItem<Id extends string> {
	id: Id;
	label: ReactNode;
	icon?: ReactNode;
	count?: number;
	disabled?: boolean;
	disabledReason?: string;
}

interface TabBarProps<Id extends string> {
	tabs: TabBarItem<Id>[];
	activeTab: Id;
	onTabChange: (id: Id) => void;
	idBase: string;
	className?: string;
	fitted?: boolean;
}

export function tabTriggerId(idBase: string, tabId: string) {
	return `${idBase}-tab-${tabId}`;
}

export function tabPanelId(idBase: string, tabId: string) {
	return `${idBase}-panel-${tabId}`;
}

export function TabBar<Id extends string>({
	tabs,
	activeTab,
	onTabChange,
	idBase,
	className,
	fitted = false,
}: TabBarProps<Id>) {
	const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
			return;
		}
		event.preventDefault();
		const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
		const delta = event.key === 'ArrowRight' ? 1 : -1;
		const nextIndex = getNextEnabledTabIndex(tabs, currentIndex, delta);
		if (nextIndex === null) {
			return;
		}
		onTabChange(tabs[nextIndex].id);
		buttonsRef.current[nextIndex]?.focus();
	};

	return (
		<div role='tablist' className={cn('flex', className)} onKeyDown={handleKeyDown}>
			{tabs.map((tab, index) => {
				const isActive = activeTab === tab.id;
				return (
					<button
						key={tab.id}
						ref={(el) => {
							buttonsRef.current[index] = el;
						}}
						type='button'
						role='tab'
						id={tabTriggerId(idBase, tab.id)}
						aria-selected={isActive}
						aria-controls={tabPanelId(idBase, tab.id)}
						aria-disabled={tab.disabled ? true : undefined}
						tabIndex={isActive ? 0 : -1}
						disabled={tab.disabled}
						title={tab.disabledReason}
						onClick={() => onTabChange(tab.id)}
						className={cn(
							'-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
							fitted ? 'w-full justify-center' : 'shrink-0 whitespace-nowrap',
							tab.disabled
								? 'cursor-not-allowed border-transparent text-muted-foreground/45'
								: isActive
									? 'border-primary text-foreground'
									: 'border-transparent text-muted-foreground hover:text-foreground',
						)}
					>
						{tab.icon}
						<span>{tab.label}</span>
						{tab.count !== undefined && (
							<span
								aria-label={`${tab.count} items`}
								className={isActive ? 'text-muted-foreground' : 'text-muted-foreground/60'}
							>
								{tab.count}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}

function getNextEnabledTabIndex<Id extends string>(
	tabs: TabBarItem<Id>[],
	currentIndex: number,
	delta: 1 | -1,
): number | null {
	for (let step = 1; step <= tabs.length; step += 1) {
		const nextIndex = (currentIndex + step * delta + tabs.length) % tabs.length;
		if (!tabs[nextIndex].disabled) {
			return nextIndex;
		}
	}
	return null;
}

interface TabPanelProps {
	idBase: string;
	tabId: string;
	className?: string;
	children: ReactNode;
}

export function TabPanel({ idBase, tabId, className, children }: TabPanelProps) {
	return (
		<div
			role='tabpanel'
			id={tabPanelId(idBase, tabId)}
			aria-labelledby={tabTriggerId(idBase, tabId)}
			className={className}
		>
			{children}
		</div>
	);
}
