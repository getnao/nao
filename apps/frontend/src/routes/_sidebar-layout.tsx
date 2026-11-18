import { useCallback, useState } from 'react';
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';

import { CommandMenu } from '@/components/command-menu';
import { CloudBillingAccessBanner } from '@/components/cloud-billing-access-banner';
import { GithubStarPrompt } from '@/components/github-star-prompt';
import { KeyboardShortcutsDialog } from '@/components/keyboard-shortcuts-dialog';
import { lucideIconQueryOptions } from '@/components/lucide-icon-by-name';
import { PageLoader } from '@/components/page-loader';
import { Sidebar } from '@/components/sidebar';
import { TrialStartedDialogController } from '@/components/trial-started-dialog';
import { CommandMenuCallbackProvider, useCommandMenuCallback } from '@/contexts/command-menu-callback';
import { SidebarProvider, useSidebar } from '@/contexts/sidebar';
import { useTheme } from '@/contexts/theme.provider';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { usePermissions } from '@/hooks/use-permissions';
import { queryClient, trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout')({
	loader: preloadSidebarMenu,
	pendingComponent: PageLoader,
	pendingMs: 0,
	pendingMinMs: 0,
	component: RouteComponent,
});

/** Loads the project's menu and its icons before the layout mounts, so its custom entries don't pop in after the defaults. */
async function preloadSidebarMenu() {
	const [project, menu] = await Promise.all([
		queryClient.ensureQueryData(trpc.project.getCurrent.queryOptions()).catch(() => null),
		queryClient.ensureQueryData(trpc.sidebarMenu.get.queryOptions()).catch(() => null),
	]);
	if (!project) {
		return;
	}
	const iconNames = menu?.entries.flatMap((entry) => (entry.icon ? [entry.icon] : [])) ?? [];
	await Promise.all(
		iconNames.map((name) => queryClient.ensureQueryData(lucideIconQueryOptions(name)).catch(() => null)),
	);
}

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
			<TrialStartedDialogController />
			<GithubStarPrompt />
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
	const navigateStories = useCallback(
		() => navigate({ to: '/stories', search: { folderId: null, view: undefined } }),
		[navigate],
	);
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
