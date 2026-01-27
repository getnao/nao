import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useMemoObject } from '@/hooks/useMemoObject';

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

type SidebarContextValue = {
	isCollapsed: boolean;
	setIsCollapsed: (collapsed: boolean) => void;
	toggleSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export const useSidebar = () => {
	const context = useContext(SidebarContext);
	if (!context) {
		throw new Error('useSidebar must be used within a SidebarProvider');
	}
	return context;
};

export const SidebarProvider = ({ children }: { children: React.ReactNode }) => {
	const [isCollapsed, setIsCollapsed] = useState(() => {
		const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
		return stored === 'true';
	});

	useEffect(() => {
		localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
	}, [isCollapsed]);

	const toggleSidebar = useCallback(() => {
		setIsCollapsed((prev) => !prev);
	}, []);

	return (
		<SidebarContext.Provider value={useMemoObject({ isCollapsed, setIsCollapsed, toggleSidebar })}>
			{children}
		</SidebarContext.Provider>
	);
};
