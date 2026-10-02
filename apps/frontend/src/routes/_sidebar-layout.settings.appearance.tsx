import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useRef } from 'react';
import type { TabBarItem } from '@/components/ui/tab-bar';

import { DateFormatSection } from '@/components/settings/date-format-section';
import { StoryThemeEditorProvider } from '@/components/settings/story-theme-editor-context';
import { StoryThemeSettings } from '@/components/settings/story-theme-settings';
import { WhiteLabelSettings } from '@/components/settings/white-label-settings';
import { SidePanel } from '@/components/side-panel/side-panel';
import { SettingsPageWrapper } from '@/components/ui/settings-card';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { SidePanelProvider } from '@/contexts/side-panel';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { usePermissions } from '@/hooks/use-permissions';
import { useSidePanel } from '@/hooks/use-side-panel';
import { requireNonViewer } from '@/lib/require-admin';
import { trpc } from '@/main';

type AppearanceTab = 'general' | 'custom-stories';

const tabs: TabBarItem<AppearanceTab>[] = [
	{ id: 'general', label: 'General' },
	{ id: 'custom-stories', label: 'Custom stories' },
];

const tabIdBase = 'appearance';

export const Route = createFileRoute('/_sidebar-layout/settings/appearance')({
	beforeLoad: requireNonViewer,
	staticData: {
		title: 'Appearance',
	},
	validateSearch: (search: Record<string, unknown>): { tab: AppearanceTab } => ({
		tab: isAppearanceTab(search.tab) ? search.tab : 'general',
	}),
	component: AppearancePage,
});

function AppearancePage() {
	const { tab } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { isAdmin } = usePermissions();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);
	const sidePanel = useSidePanel({
		containerRef,
		sidePanelRef,
		defaultWidthRatio: 0.5,
		shouldCollapseSidebar: false,
	});

	return (
		<StoryThemeEditorProvider key={project.data?.id}>
			<SidePanelProvider
				isVisible={sidePanel.isVisible}
				currentStorySlug={sidePanel.currentStorySlug}
				setCurrentStorySlug={sidePanel.setCurrentStorySlug}
				currentStoryTabIndex={sidePanel.currentStoryTabIndex}
				setCurrentStoryTabIndex={sidePanel.setCurrentStoryTabIndex}
				chatId={null}
				open={sidePanel.open}
				close={sidePanel.close}
			>
				<div ref={containerRef} className='flex h-full min-h-0'>
					<SettingsPageWrapper>
						<div className='flex flex-col gap-5'>
							<h1 className='text-lg font-semibold text-foreground'>Appearance</h1>
							<TabBar
								tabs={tabs}
								activeTab={tab}
								onTabChange={(nextTab) => {
									navigate({ search: { tab: nextTab }, replace: true });
								}}
								idBase={tabIdBase}
								className='border-b'
							/>
							<TabPanel idBase={tabIdBase} tabId={tab} className='flex min-w-0 flex-col gap-12'>
								{tab === 'general' && <GeneralSettings isAdmin={isAdmin} />}
								{tab === 'custom-stories' && <StoryThemeSettings isAdmin={isAdmin} />}
							</TabPanel>
						</div>
					</SettingsPageWrapper>
					{sidePanel.content && (
						<SidePanel
							containerRef={containerRef}
							isAnimating={sidePanel.isAnimating}
							sidePanelRef={sidePanelRef}
							resizeHandleRef={sidePanel.resizeHandleRef}
						>
							{sidePanel.content}
						</SidePanel>
					)}
				</div>
			</SidePanelProvider>
		</StoryThemeEditorProvider>
	);
}

function GeneralSettings({ isAdmin }: { isAdmin: boolean }) {
	const isCloud = useIsCloud();

	return (
		<>
			<DateFormatSection isAdmin={isAdmin} />
			{!isCloud && (
				<section className='flex flex-col gap-6'>
					<h2 className='text-base font-semibold text-foreground'>Branding</h2>
					<WhiteLabelSettings isAdmin={isAdmin} />
				</section>
			)}
		</>
	);
}

function isAppearanceTab(value: unknown): value is AppearanceTab {
	return value === 'general' || value === 'custom-stories';
}
