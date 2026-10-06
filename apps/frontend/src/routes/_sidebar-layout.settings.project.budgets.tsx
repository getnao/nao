import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Lock } from 'lucide-react';

import { BudgetSettings } from '@/components/settings/budget-settings';
import { MemberBudgetSettings } from '@/components/settings/member-budget-settings';
import { MyMemberBudget } from '@/components/settings/my-member-budget';
import { UnpricedModelsWarning } from '@/components/settings/unpriced-models-warning';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { useLicenseFeatures } from '@/hooks/use-license';
import { usePermissions } from '@/hooks/use-permissions';

type BudgetPageTab = 'general' | 'advanced';

const TAB_ID_BASE = 'budget-page';

export const Route = createFileRoute('/_sidebar-layout/settings/project/budgets')({
	staticData: {
		title: 'Budget',
		description: 'Cap what your project and your members spend on AI models.',
	},
	validateSearch: (search: Record<string, unknown>): { tab: BudgetPageTab } => ({
		tab: resolveBudgetPageTab(search.tab),
	}),
	component: BudgetPage,
});

function resolveBudgetPageTab(value: unknown): BudgetPageTab {
	return value === 'advanced' ? 'advanced' : 'general';
}

function BudgetPage() {
	const { tab } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { isAdmin } = usePermissions();
	const licenseFeatures = useLicenseFeatures();
	const hasMemberBudget = licenseFeatures.data?.['user-budget'] === true;

	const canSeeAdvanced = isAdmin || hasMemberBudget;
	const activeTab: BudgetPageTab = canSeeAdvanced ? tab : 'general';
	const tabs = [
		{ id: 'general' as const, label: 'General' },
		...(canSeeAdvanced
			? [
					{
						id: 'advanced' as const,
						label: (
							<span className='flex items-center gap-1.5'>
								Advanced
								{isAdmin && !hasMemberBudget && (
									<Lock aria-label='Enterprise feature' className='size-3 text-primary' />
								)}
							</span>
						),
					},
				]
			: []),
	];

	return (
		<>
			<TabBar
				tabs={tabs}
				activeTab={activeTab}
				onTabChange={(nextTab) => {
					void navigate({ search: { tab: nextTab }, replace: true });
				}}
				idBase={TAB_ID_BASE}
				className='border-b'
			/>
			<TabPanel idBase={TAB_ID_BASE} tabId={activeTab} className='flex flex-col gap-12'>
				{isAdmin && <UnpricedModelsWarning />}
				{activeTab === 'general' ? (
					<BudgetSettings />
				) : isAdmin ? (
					<MemberBudgetSettings isLicensed={hasMemberBudget} />
				) : (
					<MyMemberBudget />
				)}
			</TabPanel>
		</>
	);
}
