import { Link } from '@tanstack/react-router';
import { Check, EyeOff } from 'lucide-react';

import { getVisibleSettingsNavGroups } from '@/components/sidebar-settings-nav';
import { UserGroupSwitchRow } from '@/components/settings/user-group-switch-row';
import { useIsCloud } from '@/hooks/use-nao-mode';
import { cn } from '@/lib/utils';

interface UserGroupAdvancedSettingsProps {
	showAllSettings: boolean;
	onShowAllSettingsChange: (showAllSettings: boolean) => void;
	isDefaultGroup: boolean;
	allUsersGroup: { id: string; showAllSettings: boolean } | null;
}

interface AccessSummaryRow {
	label: string;
	pages: string;
	visible: boolean;
}

export function UserGroupAdvancedSettings({
	showAllSettings,
	onShowAllSettingsChange,
	isDefaultGroup,
	allUsersGroup,
}: UserGroupAdvancedSettingsProps) {
	const isCoveredByAllUsers = !isDefaultGroup && allUsersGroup?.showAllSettings === true;
	const membersSeeAllSettings = showAllSettings || isCoveredByAllUsers;
	const summaryRows = useAccessSummaryRows(membersSeeAllSettings);

	return (
		<div className='flex flex-col gap-5'>
			<div>
				<h3 className='text-sm font-medium'>Settings visibility</h3>
				<p className='text-xs text-muted-foreground'>
					Choose whether members with the User role see project and organization settings, or only their
					account.
				</p>
			</div>
			<UserGroupSwitchRow
				id='user-group-show-all-settings'
				label='Show all settings to users'
				description={
					isDefaultGroup
						? 'Applies to everyone in the project, including new users.'
						: 'Members of this group see every settings page their role allows.'
				}
				checked={showAllSettings}
				onCheckedChange={onShowAllSettingsChange}
			/>
			{isCoveredByAllUsers && allUsersGroup && <CoveredByAllUsersNotice allUsersGroupId={allUsersGroup.id} />}
			<AccessSummary rows={summaryRows} showAllSettings={membersSeeAllSettings} />
		</div>
	);
}

function AccessSummary({ rows, showAllSettings }: { rows: AccessSummaryRow[]; showAllSettings: boolean }) {
	return (
		<section className='flex flex-col gap-3'>
			<div className='flex items-center justify-between gap-3'>
				<h3 className='text-sm font-medium'>What members with the User role see</h3>
				<span
					className={cn(
						'rounded-full px-2 py-0.5 text-xs font-medium',
						showAllSettings ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
					)}
				>
					{showAllSettings ? 'All settings' : 'Account only'}
				</span>
			</div>
			<ul className='divide-y rounded-lg border'>
				{rows.map((row) => (
					<li key={row.label} className='flex items-start gap-3 px-3 py-2.5'>
						{row.visible ? (
							<Check className='mt-0.5 size-4 shrink-0 text-primary' aria-label='Visible' />
						) : (
							<EyeOff className='mt-0.5 size-4 shrink-0 text-muted-foreground' aria-label='Hidden' />
						)}
						<div className={cn('min-w-0', !row.visible && 'text-muted-foreground')}>
							<p className='text-sm font-medium'>{row.label}</p>
							<p className='text-xs text-muted-foreground'>{row.pages}</p>
						</div>
					</li>
				))}
			</ul>
			<p className='text-xs text-muted-foreground'>
				Admins and context admins always keep their settings, and viewers only see their account. Hidden pages
				redirect to Account.
			</p>
		</section>
	);
}

function CoveredByAllUsersNotice({ allUsersGroupId }: { allUsersGroupId: string }) {
	return (
		<p className='rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground'>
			All Users already shows all settings to everyone, so this toggle only takes effect once it is turned off for{' '}
			<Link
				to='/settings/project/user-groups/$groupId'
				params={{ groupId: allUsersGroupId }}
				search={{ tab: 'advanced' }}
				className='font-medium text-foreground underline underline-offset-2'
			>
				All Users
			</Link>
			.
		</p>
	);
}

function useAccessSummaryRows(showAllSettings: boolean): AccessSummaryRow[] {
	const isCloud = useIsCloud();
	const userRoleNavGroups = getVisibleSettingsNavGroups({
		canSeeAdvancedSettings: true,
		isAdmin: false,
		isAutomationsEnabled: false,
		isCloudBillingEnabled: false,
		isContextAdmin: false,
		isCloud,
		isOrgAdmin: false,
		isViewer: false,
	});

	return [
		{ label: 'Chat with data', pages: 'Chats and shared content', visible: true },
		...userRoleNavGroups.map((group) => ({
			label: group.label,
			pages: group.items.map((item) => item.label).join(', '),
			visible: !group.isAdvanced || showAllSettings,
		})),
	];
}
