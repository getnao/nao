/* @license Enterprise */

import { Link } from '@tanstack/react-router';
import { getNextPeriodStart } from '@nao/shared/date';
import { getMemberBudgetStatus, resolveMemberBudgetLimit } from '@nao/shared/member-budget';
import type { MemberBudgetPeriod } from '@nao/shared/types';

import { BudgetCell } from '@/components/settings/budget-cell';
import { BudgetLimitRow } from '@/components/settings/budget-limit-row';
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
}

interface UserGroupBudgetProps {
	groupId: string | null;
	isLicensed: boolean;
	isDefaultGroup: boolean;
	isLoading: boolean;
	isError: boolean;
	limitUsd: number | null;
	defaultLimitUsd: number;
	period: MemberBudgetPeriod;
	members: UserGroupBudgetMember[];
	groups: UserGroupBudgetGroup[];
	onLimitChange: (limitUsd: number | null) => void;
}

export function UserGroupBudget({
	groupId,
	isLicensed,
	isDefaultGroup,
	isLoading,
	isError,
	limitUsd,
	defaultLimitUsd,
	period,
	members,
	groups,
	onLimitChange,
}: UserGroupBudgetProps) {
	const applicableMembers =
		isLicensed && groupId
			? listMembersCoveredByGroupBudget({
					groupId,
					isDefaultGroup,
					limitUsd,
					defaultLimitUsd,
					members,
					groups,
				})
			: [];

	return (
		<section className='flex min-h-64 flex-col gap-4'>
			<div className='flex items-start justify-between gap-3'>
				<div>
					<h3 className='text-sm font-medium'>Budget per member</h3>
					<p className='mt-1 text-xs text-muted-foreground'>
						Cap what each member of this group can spend across all providers.
					</p>
				</div>
			</div>
			{!isLicensed ? (
				<div className='flex items-start justify-between gap-4 rounded-lg border px-3 py-3'>
					<div className='min-w-0'>
						<p className='text-sm font-medium'>Enterprise feature inactive</p>
						<p className='text-xs text-muted-foreground'>No member budget is currently enforced.</p>
					</div>
					<UpgradeToEnterprise />
				</div>
			) : isLoading ? (
				<p className='text-sm text-muted-foreground'>Loading budgets...</p>
			) : isError ? (
				<p className='text-sm text-destructive'>Failed to load budgets. Reload the page to edit them.</p>
			) : (
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
			)}
			{isLicensed && !isLoading && !isError && (
				<GroupBudgetUsage members={applicableMembers} limitUsd={limitUsd ?? defaultLimitUsd} period={period} />
			)}
			<p className='text-xs text-muted-foreground'>
				A member&apos;s personal budget always wins, and members in several groups get the most generous group
				budget.{' '}
				<Link
					to='/settings/project/budgets'
					search={{ tab: 'advanced' }}
					className='underline underline-offset-2 hover:text-foreground'
				>
					Manage all member budgets
				</Link>
			</p>
		</section>
	);
}

function GroupBudgetUsage({
	members,
	limitUsd,
	period,
}: {
	members: UserGroupBudgetMember[];
	limitUsd: number;
	period: MemberBudgetPeriod;
}) {
	const totalSpendUsd = members.reduce((total, member) => total + member.spendUsd, 0);
	const totalLimitUsd = limitUsd * members.length;
	const status = getMemberBudgetStatus(totalSpendUsd, totalLimitUsd);
	const periodLabel = PERIOD_LABELS[period].toLowerCase();

	return (
		<div className='rounded-lg border px-3 py-3'>
			<div className='flex flex-col gap-3'>
				<div className='flex items-center justify-between gap-2'>
					<span className='text-sm tabular-nums'>
						<span className='text-lg font-semibold'>{formatUsd(totalSpendUsd, 2)}</span>
						<span className='text-muted-foreground'>
							{status === 'unlimited'
								? ` spent this ${periodLabel}`
								: ` of ${formatUsd(totalLimitUsd)} / ${periodLabel}`}
						</span>
					</span>
					<Badge variant='ghost' className={cn('text-[11px]', STATUS_META[status].className)}>
						{STATUS_META[status].label}
					</Badge>
				</div>
				<GroupBudgetUsageBar members={members} limitUsd={limitUsd} />
				<div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
					<span>{members.length === 1 ? '1 member covered' : `${members.length} members covered`}</span>
					<span>Resets on {toUtcDateString(getNextPeriodStart(period))}</span>
				</div>
			</div>
		</div>
	);
}

function GroupBudgetUsageBar({ members, limitUsd }: { members: UserGroupBudgetMember[]; limitUsd: number }) {
	if (members.length === 0) {
		return <div className='h-2 w-full rounded-full bg-muted' />;
	}

	const sortedMembers = [...members].sort((left, right) => right.spendUsd - left.spendUsd);
	const totalSpendUsd = sortedMembers.reduce((total, member) => total + member.spendUsd, 0);
	const totalLimitUsd = limitUsd * members.length;
	const spendSegments = limitUsd > 0 ? buildSpendSegments(sortedMembers, totalLimitUsd) : [];

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div
					className='flex h-2 w-full overflow-hidden rounded-full bg-muted'
					aria-label={`${formatUsd(totalSpendUsd, 2)} spent across ${members.length} covered members`}
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
				<GroupBudgetUsageTooltip members={sortedMembers} limitUsd={limitUsd} />
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

function GroupBudgetUsageTooltip({ members, limitUsd }: { members: UserGroupBudgetMember[]; limitUsd: number }) {
	if (members.length === 0) {
		return <span>No members are currently covered by this budget.</span>;
	}

	return (
		<div className='flex flex-col gap-2'>
			<div className='font-medium text-foreground'>Covered members</div>
			<div className='grid gap-1.5'>
				{members.map((member, index) => {
					const status = getMemberBudgetStatus(member.spendUsd, limitUsd);
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
