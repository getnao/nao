import { useSidebar } from '@/contexts/sidebar';
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH } from '@/lib/side-panel';

export function useSidebarContentOffset(): number {
	const { isMobile, isCollapsed } = useSidebar();
	if (isMobile) {
		return 0;
	}
	return isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;
}

export function useContentCenteredStyle(): React.CSSProperties {
	const sidebarWidth = useSidebarContentOffset();
	return { left: `calc(50% + ${sidebarWidth / 2}px)` };
}
