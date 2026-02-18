import { createContext, useContext, useCallback } from 'react';
import { useMemoObject } from '@/hooks/useMemoObject';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { createLocalStorage } from '@/lib/local-storage';

type SidebarContextValue = {
	isCollapsed: boolean;
	toggle: (opts?: { persist?: boolean }) => void;
	collapse: (opts?: { persist?: boolean }) => void;
	expand: (opts?: { persist?: boolean }) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export const useSidebar = () => {
	const context = useContext(SidebarContext);
	if (!context) {
		throw new Error('useSidebar must be used within a SidebarProvider');
	}
	return context;
};

const storage = createLocalStorage<'true' | 'false'>('sidebar-collapsed', 'false');

export const SidebarProvider = ({ children }: { children: React.ReactNode }) => {
	const [isCollapsed, setIsCollapsed] = useLocalStorage(storage);

	const toggle: SidebarContextValue['toggle'] = useCallback(
		(opts) => {
			setIsCollapsed((prev) => (prev === 'true' ? 'false' : 'true'), opts);
		},
		[setIsCollapsed],
	);

	const collapse: SidebarContextValue['collapse'] = useCallback(
		(opts) => {
			setIsCollapsed('true', opts);
		},
		[setIsCollapsed],
	);

	const expand: SidebarContextValue['expand'] = useCallback(
		(opts) => {
			setIsCollapsed('false', opts);
		},
		[setIsCollapsed],
	);

	return (
		<SidebarContext.Provider
			value={useMemoObject({ isCollapsed: isCollapsed === 'true', toggle, collapse, expand })}
		>
			{children}
		</SidebarContext.Provider>
	);
};
