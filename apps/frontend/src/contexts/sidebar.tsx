import { createContext, useContext, useCallback, useState } from 'react';
import { useMemoObject } from '@/hooks/useMemoObject';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { createLocalStorage } from '@/lib/local-storage';
import { useIsMobile } from '@/hooks/use-is-mobile';

type SidebarContextValue = {
	isMobile: boolean;
	isCollapsed: boolean;
	isMobileOpen: boolean;
	toggle: (opts?: { persist?: boolean }) => void;
	collapse: (opts?: { persist?: boolean }) => void;
	expand: (opts?: { persist?: boolean }) => void;
	openMobile: () => void;
	closeMobile: () => void;
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
	const isMobile = useIsMobile();
	const [isCollapsed, setIsCollapsed] = useLocalStorage(storage);
	const [isMobileOpen, setIsMobileOpen] = useState(false);

	const toggle: SidebarContextValue['toggle'] = useCallback(
		(opts) => {
			if (isMobile) {
				setIsMobileOpen((prev) => !prev);
				return;
			}
			setIsCollapsed((prev) => (prev === 'true' ? 'false' : 'true'), opts);
		},
		[setIsCollapsed, isMobile],
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

	const openMobile = useCallback(() => setIsMobileOpen(true), []);
	const closeMobile = useCallback(() => setIsMobileOpen(false), []);

	return (
		<SidebarContext.Provider
			value={useMemoObject({
				isMobile,
				isCollapsed: isCollapsed === 'true',
				isMobileOpen,
				toggle,
				collapse,
				expand,
				openMobile,
				closeMobile,
			})}
		>
			{children}
		</SidebarContext.Provider>
	);
};
