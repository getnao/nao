/* @license Enterprise */

import { Link } from '@tanstack/react-router';
import { getNextPeriodStart } from '@nao/shared/date';
import { getMemberBudgetStatus, resolveMemberBudgetLimit } from '@nao/shared/member-budget';
import type { MemberBudgetPeriod } from '@nao/shared/types';

import { BudgetCell } from '@/components/settings/budget-cell';
import { BudgetLimitRow } from '@/components/settings/budget-limit-row';
import { LockedFieldset } from '@/components/settings/locked-fieldset';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatUsd, PERIOD_LABELS, STATUS_META } from '@/lib/member-budget';
import { cn, toUtcDateString } from '@/lib/utils';

interface UserGroupBudgetMember {
	id: string;
	name: string;
	email: string;
	spendUsd: number;
	personalLimitUsd: number | null;
	groupIds: string[];
}

interface UserGroupBudgetGroup {
	id: string;
	isDefault: boolean;
	limitUsd: number | null;
	spendUsd: number;
}

interface UserGroupBudgetProps {
	groupId: string | null;
	isLicensed: boolean;
	isDefaultGroup: boolean;
	isLoading: boolean;
	isError: boolean;
	limitUsd: number | null;
	sharedLimitUsd: number | null;
	defaultLimitUsd: number;
	period: MemberBudgetPeriod;
	members: UserGroupBudgetMember[];
	groups: UserGroupBudgetGroup[];
	onLimitChange: (limitUsd: number | null) => void;
	onSharedLimitChange: (limitUsd: number | null) => void;
}

export function UserGroupBudget({
	groupId,
	isLicensed,
	isDefaultGroup,
	isLoading,
	isError,
	limitUsd,
	sharedLimitUsd,
	defaultLimitUsd,
	period,
	members,
	groups,
	onLimitChange,
	onSharedLimitChange,
}: UserGroupBudgetProps) {
	const applicableMembers = groupId
		? listMembersCoveredByGroupBudget({
				groupId,
				isDefaultGroup,
				limitUsd,
				defaultLimitUsd,
				members,
				groups,
			})
		: [];
	const isBudgetReady = !isLicensed || (!isLoading && !isError);
	const groupMembers = isDefaultGroup
		? members
		: members.filter((member) => groupId !== null && member.groupIds.includes(groupId));
	const groupSpendUsd = groups.find((group) => group.id === groupId)?.spendUsd ?? 0;

	return (
		<section className='flex min-h-64 flex-col gap-4'>
			<div className='flex items-start justify-between gap-3'>
				<div>
					<h3 className='text-sm font-medium'>Budget per member</h3>
					<p className='mt-1 text-xs text-muted-foreground'>
						Cap what each member of this group can spend across all providers.
					</p>
				</div>
				<div className='flex shrink-0 items-center gap-2'>
					{!isLicensed && <UpgradeToEnterprise />}
					<Link
						to='/settings/project/budgets'
						search={{ tab: 'advanced' }}
						className='text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground'
					>
						Manage all member budgets
					</Link>
				</div>
			</div>
			{isLicensed && isLoading ? (
				<p className='text-sm text-muted-foreground'>Loading budgets...</p>
			) : isLicensed && isError ? (
				<p className='text-sm text-destructive'>Failed to load budgets. Reload the page to edit them.</p>
			) : (
				<LockedFieldset disabled={!isLicensed}>
					<BudgetLimitRow
						description={
							isDefaultGroup
								? 'Everyone starts with this budget unless a group or personal budget applies.'
								: 'Members get this budget instead of the project default.'
						}
						unitLabel={`/member per ${PERIOD_LABELS[period].toLowerCase()}`}
					>
						{isDefaultGroup ? (
							<BudgetCell
								limitUsd={limitUsd ?? 0}
								onChange={(value) => onLimitChange(value ?? 0)}
								className='w-36'
							/>
						) : (
							<BudgetCell
								limitUsd={limitUsd ?? defaultLimitUsd}
								inherited={{ source: 'default', limitUsd: defaultLimitUsd }}
								isInherited={limitUsd === null}
								onChange={onLimitChange}
								className='w-36'
							/>
						)}
					</BudgetLimitRow>
					<GroupBudgetUsage
						members={applicableMembers}
						spendUsd={sumSpend(applicableMembers)}
						limitUsd={(limitUsd ?? defaultLimitUsd) * applicableMembers.length}
						memberLimitUsd={limitUsd ?? defaultLimitUsd}
						membersLabel='covered members'
						caption={formatMemberCount(applicableMembers.length, 'covered')}
						period={period}
					/>
				</LockedFieldset>
			)}
			<p className='text-xs text-muted-foreground'>
				A member&apos;s personal budget always wins, and members in several groups get the most generous group
				budget.
			</p>
			{isBudgetReady && (
				<GroupSharedBudget
					isLicensed={isLicensed}
					sharedLimitUsd={sharedLimitUsd}
					spendUsd={groupSpendUsd}
					members={groupMembers}
					period={period}
					onSharedLimitChange={onSharedLimitChange}
				/>
			)}
		</section>
	);
}

function GroupSharedBudget({
	isLicensed,
	sharedLimitUsd,
	spendUsd,
	members,
	period,
	onSharedLimitChange,
}: {
	isLicensed: boolean;
	sharedLimitUsd: number | null;
	spendUsd: number;
	members: UserGroupBudgetMember[];
	period: MemberBudgetPeriod;
	onSharedLimitChange: (limitUsd: number | null) => void;
}) {
	return (
		<div className='flex flex-col gap-4 border-t pt-4'>
			<div>
				<h3 className='text-sm font-medium'>Shared budget</h3>
				<p className='mt-1 text-xs text-muted-foreground'>
					One cap on the combined spend of all members of this group. Members are blocked as soon as their own
					budget or this shared budget is used up, until it resets.
				</p>
			</div>
			<LockedFieldset disabled={!isLicensed}>
				<BudgetLimitRow
					label='Shared limit'
					description='Applies to the combined spend of the whole group.'
					unitLabel={`/group per ${PERIOD_LABELS[period].toLowerCase()}`}
				>
					<BudgetCell
						limitUsd={sharedLimitUsd ?? 0}
						onChange={(value) => onSharedLimitChange(value || null)}
						className='w-36'
					/>
				</BudgetLimitRow>
				<GroupBudgetUsage
					members={members}
					spendUsd={spendUsd}
					limitUsd={sharedLimitUsd ?? 0}
					memberLimitUsd={null}
					membersLabel='group members'
					caption={formatMemberCount(members.length, 'sharing this budget')}
					period={period}
				/>
			</LockedFieldset>
		</div>
	);
}

function GroupBudgetUsage({
	members,
	spendUsd,
	limitUsd,
	memberLimitUsd,
	membersLabel,
	caption,
	period,
}: {
	members: UserGroupBudgetMember[];
	spendUsd: number;
	limitUsd: number;
	memberLimitUsd: number | null;
	membersLabel: string;
	caption: string;
	period: MemberBudgetPeriod;
}) {
	const status = getMemberBudgetStatus(spendUsd, limitUsd);
	const periodLabel = PERIOD_LABELS[period].toLowerCase();

	return (
		<div className='rounded-lg border px-3 py-3'>
			<div className='flex flex-col gap-3'>
				<div className='flex items-center justify-between gap-2'>
					<span className='text-sm tabular-nums'>
						<span className='text-lg font-semibold'>{formatUsd(spendUsd, 2)}</span>
						<span className='text-muted-foreground'>
							{status === 'unlimited'
								? ` spent this ${periodLabel}`
								: ` of ${formatUsd(limitUsd)} / ${periodLabel}`}
						</span>
					</span>
					<Badge variant='ghost' className={cn('text-[11px]', STATUS_META[status].className)}>
						{STATUS_META[status].label}
					</Badge>
				</div>
				<GroupBudgetUsageBar
					members={members}
					limitUsd={limitUsd}
					memberLimitUsd={memberLimitUsd}
					membersLabel={membersLabel}
				/>
				<div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
					<span>{caption}</span>
					<span>Resets on {toUtcDateString(getNextPeriodStart(period))}</span>
				</div>
			</div>
		</div>
	);
}

function GroupBudgetUsageBar({
	members,
	limitUsd,
	memberLimitUsd,
	membersLabel,
}: {
	members: UserGroupBudgetMember[];
	limitUsd: number;
	memberLimitUsd: number | null;
	membersLabel: string;
}) {
	if (members.length === 0) {
		return <div className='h-2 w-full rounded-full bg-muted' />;
	}

	const sortedMembers = [...members].sort((left, right) => right.spendUsd - left.spendUsd);
	const spendSegments = limitUsd > 0 ? buildSpendSegments(sortedMembers, limitUsd) : [];

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div
					className='flex h-2 w-full overflow-hidden rounded-full bg-muted'
					aria-label={`${formatUsd(sumSpend(members), 2)} spent across ${members.length} ${membersLabel}`}
				>
					{limitUsd <= 0 ? (
						sortedMembers.map((member, index) => (
							<div
								key={member.id}
								className={cn(
									'h-full flex-1 border-r border-background/80 last:border-r-0',
									memberSegmentClassName(index),
								)}
							/>
						))
					) : (
						<>
							{spendSegments.map(({ member, width, colorIndex }) => (
								<div
									key={member.id}
									className={cn('h-full', memberSegmentClassName(colorIndex))}
									style={{ width: `${width}%` }}
								/>
							))}
							<div className='h-full min-w-0 flex-1 bg-muted' />
						</>
					)}
				</div>
			</TooltipTrigger>
			<TooltipContent className='w-72 max-w-72 p-3'>
				<GroupBudgetUsageTooltip
					members={sortedMembers}
					memberLimitUsd={memberLimitUsd ?? 0}
					membersLabel={membersLabel}
				/>
			</TooltipContent>
		</Tooltip>
	);
}

function buildSpendSegments(
	members: UserGroupBudgetMember[],
	totalLimitUsd: number,
): Array<{ member: UserGroupBudgetMember; width: number; colorIndex: number }> {
	let remaining = 100;
	const segments: Array<{ member: UserGroupBudgetMember; width: number; colorIndex: number }> = [];
	for (const [index, member] of members.entries()) {
		const width = Math.min(remaining, (member.spendUsd / totalLimitUsd) * 100);
		if (width > 0) {
			segments.push({ member, width, colorIndex: index });
			remaining -= width;
		}
		if (remaining <= 0) {
			break;
		}
	}
	return segments;
}

function GroupBudgetUsageTooltip({
	members,
	memberLimitUsd,
	membersLabel,
}: {
	members: UserGroupBudgetMember[];
	memberLimitUsd: number;
	membersLabel: string;
}) {
	if (members.length === 0) {
		return <span>No members are currently covered by this budget.</span>;
	}

	return (
		<div className='flex flex-col gap-2'>
			<div className='font-medium text-foreground first-letter:uppercase'>{membersLabel}</div>
			<div className='grid gap-1.5'>
				{members.map((member, index) => {
					const status = getMemberBudgetStatus(member.spendUsd, memberLimitUsd);
					return (
						<div key={member.id} className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3'>
							<span className='flex min-w-0 items-center gap-1.5'>
								<span className={cn('size-2 shrink-0 rounded-full', memberSegmentClassName(index))} />
								<span className='min-w-0'>
									<span className='block truncate text-muted-foreground'>{member.email}</span>
									{member.name !== member.email && (
										<span className='block truncate text-[10px] text-muted-foreground/70'>
											{member.name}
										</span>
									)}
								</span>
							</span>
							<span className={cn('tabular-nums', spendClassName(status))}>
								{formatUsd(member.spendUsd, 2)}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function listMembersCoveredByGroupBudget({
	groupId,
	isDefaultGroup,
	limitUsd,
	defaultLimitUsd,
	members,
	groups,
}: {
	groupId: string;
	isDefaultGroup: boolean;
	limitUsd: number | null;
	defaultLimitUsd: number;
	members: UserGroupBudgetMember[];
	groups: UserGroupBudgetGroup[];
}): UserGroupBudgetMember[] {
	return members.filter((member) => {
		if (member.personalLimitUsd !== null) {
			return false;
		}
		const groupLimits = listGroupLimitsForMember(member, groups, groupId, limitUsd);
		if (isDefaultGroup) {
			return groupLimits.length === 0;
		}
		return (
			member.groupIds.includes(groupId) &&
			limitUsd !== null &&
			resolveMemberBudgetLimit(null, groupLimits, defaultLimitUsd) === limitUsd
		);
	});
}

function listGroupLimitsForMember(
	member: UserGroupBudgetMember,
	groups: UserGroupBudgetGroup[],
	selectedGroupId: string,
	selectedLimitUsd: number | null,
): number[] {
	return groups
		.filter((group) => !group.isDefault && member.groupIds.includes(group.id))
		.map((group) => (group.id === selectedGroupId ? selectedLimitUsd : group.limitUsd))
		.filter((limitUsd): limitUsd is number => limitUsd !== null);
}

function sumSpend(members: UserGroupBudgetMember[]): number {
	return members.reduce((total, member) => total + member.spendUsd, 0);
}

function formatMemberCount(count: number, suffix: string): string {
	return `${count} ${count === 1 ? 'member' : 'members'} ${suffix}`;
}

function memberSegmentClassName(index: number): string {
	const colors = [
		'bg-emerald-500',
		'bg-sky-500',
		'bg-violet-500',
		'bg-amber-500',
		'bg-rose-500',
		'bg-cyan-500',
		'bg-fuchsia-500',
		'bg-lime-500',
	];
	return colors[index % colors.length];
}

function spendClassName(status: ReturnType<typeof getMemberBudgetStatus>): string {
	if (status === 'exceeded') {
		return 'text-destructive font-medium';
	}
	if (status === 'close') {
		return 'text-amber-500 font-medium';
	}
	return 'text-foreground';
}
