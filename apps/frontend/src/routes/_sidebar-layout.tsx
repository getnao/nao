import { useCallback, useState } from 'react';
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';

import { CommandMenu } from '@/components/command-menu';
import { CloudBillingAccessBanner } from '@/components/cloud-billing-access-banner';
import { KeyboardShortcutsDialog } from '@/components/keyboard-shortcuts-dialog';
import { Sidebar } from '@/components/sidebar';
import { CommandMenuCallbackProvider, useCommandMenuCallback } from '@/contexts/command-menu-callback';
import { SidebarProvider, useSidebar } from '@/contexts/sidebar';
import { useTheme } from '@/contexts/theme.provider';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { usePermissions } from '@/hooks/use-permissions';

export const Route = createFileRoute('/_sidebar-layout')({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<CommandMenuCallbackProvider>
			<SidebarProvider>
				<SidebarLayoutContent />
			</SidebarProvider>
		</CommandMenuCallbackProvider>
	);
}

function SidebarLayoutContent() {
	const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = useState(false);

	return (
		<>
			<GlobalShortcuts onOpenKeyboardShortcuts={() => setKeyboardShortcutsOpen(true)} />
			<Sidebar />
			<CommandMenu onOpenKeyboardShortcuts={() => setKeyboardShortcutsOpen(true)} />
			<KeyboardShortcutsDialog open={keyboardShortcutsOpen} onOpenChange={setKeyboardShortcutsOpen} />
			<div className='flex min-h-0 min-w-0 flex-1 flex-col'>
				<CloudBillingAccessBanner />
				<div className='flex min-h-0 min-w-0 flex-1'>
					<Outlet />
				</div>
			</div>
		</>
	);
}

function GlobalShortcuts({ onOpenKeyboardShortcuts }: { onOpenKeyboardShortcuts: () => void }) {
	const navigate = useNavigate();
	const { toggle } = useSidebar();
	const { theme, setTheme } = useTheme();
	const { fire: openCommandMenu } = useCommandMenuCallback();
	const { canStartNewChat } = usePermissions();

	const navigateHome = useCallback(() => navigate({ to: '/' }), [navigate]);
	const navigateStories = useCallback(() => navigate({ to: '/stories', search: { folderId: null } }), [navigate]);
	const toggleTheme = useCallback(() => {
		setTheme(theme === 'light' ? 'dark' : 'light');
	}, [theme, setTheme]);

	useKeyboardShortcuts({
		'toggle-sidebar': toggle,
		'command-menu': openCommandMenu,
		'toggle-theme': toggleTheme,
		'new-chat': canStartNewChat ? navigateHome : undefined,
		'go-to-stories': navigateStories,
		'keyboard-help': onOpenKeyboardShortcuts,
	});

	return null;
}
