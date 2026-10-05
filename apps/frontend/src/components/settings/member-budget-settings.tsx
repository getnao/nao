/* @license Enterprise */

import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Info, Search } from 'lucide-react';
import { getNextPeriodStart } from '@nao/shared/date';
import {
	DEFAULT_MEMBER_BUDGET_PERIOD,
	getMemberBudgetStatus,
	resolveMemberBudgetLimit,
} from '@nao/shared/member-budget';
import { MEMBER_BUDGET_PERIODS } from '@nao/shared/types';
import type { InheritedMemberBudgetSource, MemberBudgetStatus } from '@nao/shared/member-budget';
import type { MemberBudgetPeriod } from '@nao/shared/types';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { inferRouterOutputs } from '@trpc/server';

import { BudgetCell } from '@/components/settings/budget-cell';
import { LockedFieldset } from '@/components/settings/locked-fieldset';
import { ResponsiveGroupChips } from '@/components/settings/user-group-chips';
import { UnsavedChangesFooter } from '@/components/settings/unsaved-changes-footer';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineBadge } from '@/components/ui/inline-badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useSession } from '@/lib/auth-client';
import {
	clampLimit,
	formatUsd,
	listChangedLimits,
	PERIOD_LABELS,
	PERIOD_RANGE_HINTS,
	STATUS_META,
} from '@/lib/member-budget';
import { cn, toUtcDateString } from '@/lib/utils';
import { trpc } from '@/main';

type MemberBudgetOverview = inferRouterOutputs<TrpcRouter>['memberBudget']['getOverview'];
type UserGroupOverview = inferRouterOutputs<TrpcRouter>['userGroup']['overview'];
type MemberBudgetRow = MemberBudgetOverview['members'][number];
type MemberBudgetGroup = MemberBudgetOverview['groups'][number];
type LimitsById = Record<string, number>;

interface LimitDraft {
	personalBudgets: LimitsById;
	groupBudgets: LimitsById;
	defaultLimitUsd: number;
	period: MemberBudgetPeriod;
}

const EMPTY_LIMIT_DRAFT: LimitDraft = {
	personalBudgets: {},
	groupBudgets: {},
	defaultLimitUsd: 0,
	period: DEFAULT_MEMBER_BUDGET_PERIOD,
};

type SortKey = 'name' | 'spend' | 'limit';
type SortDirection = 'asc' | 'desc';
type FilterOption = { value: string; label: string };

const TABLE_EDGE_PADDING = '[&_tr>*:first-child]:pl-4 [&_tr>*:last-child]:pr-4';

const ALL_FILTER_VALUE = 'all';
const FILTER_TRIGGER_CLASS_NAME = 'min-w-40 font-normal';

const USAGE_FILTER_OPTIONS: FilterOption[] = [
	{ value: ALL_FILTER_VALUE, label: 'All usage' },
	...(['exceeded', 'close', 'under', 'unlimited'] as const).map((status) => ({
		value: status,
		label: STATUS_META[status].label,
	})),
];

interface MemberBudgetSettingsProps {
	isLicensed: boolean;
}

export function MemberBudgetSettings({ isLicensed }: MemberBudgetSettingsProps) {
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const overview = useMemberBudgetOverview(isLicensed);
	const isLocked = !isLicensed;
	const lockedAction = isLocked ? <UpgradeToEnterprise /> : undefined;
	const { draft, savedDraft, setDraft, isDirty, resetDraft } = useLimitDraft(overview.data);

	const saveMutation = useMutation(
		trpc.memberBudget.setBudgets.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: [['memberBudget']] }),
					queryClient.invalidateQueries({ queryKey: [['budget']] }),
				]);
			},
		}),
	);

	const savedPeriod = overview.data?.period ?? DEFAULT_MEMBER_BUDGET_PERIOD;
	const members = useMembersSpendForPeriod(overview.data?.members, draft.period, savedPeriod);
	const groups = useMemo(() => overview.data?.groups ?? [], [overview.data?.groups]);
	const defaultGroupName = groups.find((group) => group.isDefault)?.name ?? 'All Users';
	const allocatedUsd = members.reduce((total, member) => total + resolveLimit(member, draft), 0);

	function updatePersonalBudget(userId: string, limitUsd: number | null) {
		setDraft((previous) => ({
			...previous,
			personalBudgets: withLimit(previous.personalBudgets, userId, limitUsd),
		}));
	}

	function updateGroupBudget(groupId: string, limitUsd: number | null) {
		setDraft((previous) => ({ ...previous, groupBudgets: withLimit(previous.groupBudgets, groupId, limitUsd) }));
	}

	function updateDefaultLimit(limitUsd: number) {
		setDraft((previous) => ({ ...previous, defaultLimitUsd: limitUsd }));
	}

	function updatePeriod(period: MemberBudgetPeriod) {
		setDraft((previous) => ({ ...previous, period }));
	}

	function handleSave() {
		const saved = savedDraft ?? EMPTY_LIMIT_DRAFT;
		saveMutation.mutate({
			period: draft.period,
			defaultLimitUsd: draft.defaultLimitUsd,
			personalBudgets: listChangedLimits(saved.personalBudgets, draft.personalBudgets).map(
				({ id, limitUsd }) => ({
					userId: id,
					limitUsd,
				}),
			),
			groupBudgets: listChangedLimits(saved.groupBudgets, draft.groupBudgets).map(({ id, limitUsd }) => ({
				groupId: id,
				limitUsd,
			})),
		});
	}

	return (
		<>
			<LockedFieldset disabled={isLocked} className='grid gap-3 sm:grid-cols-2'>
				<KpiCard value={formatUsd(allocatedUsd)} label='Allocated across all members' />
				<KpiCard
					value={<PeriodPicker period={draft.period} disabled={!overview.data} onChange={updatePeriod} />}
					label={`Budget period · resets on ${toUtcDateString(getNextPeriodStart(draft.period))}`}
					hint={PERIOD_RANGE_HINTS[draft.period]}
				/>
			</LockedFieldset>

			<SettingsCard
				title='Group budgets'
				description={
					<>
						<span className='font-medium text-foreground'>{defaultGroupName}</span> sets the default budget
						of every member. Other groups replace it for their members: a personal budget still wins, and
						members in several groups get the most generous one.
					</>
				}
				action={lockedAction}
				flush
			>
				<LockedFieldset disabled={isLocked} className='gap-0'>
					<GroupBudgetsTable
						groups={groups}
						members={members}
						groupBudgets={draft.groupBudgets}
						defaultLimitUsd={draft.defaultLimitUsd}
						onGroupBudgetChange={updateGroupBudget}
						onDefaultLimitChange={updateDefaultLimit}
					/>
				</LockedFieldset>
			</SettingsCard>

			<MemberBudgetsCard
				members={members}
				groups={groups}
				draft={draft}
				currentUserId={session?.user?.id}
				isLocked={isLocked}
				isLoading={overview.isLoading}
				isError={overview.isError}
				onPersonalBudgetChange={updatePersonalBudget}
			/>

			{!isLocked && (isDirty || saveMutation.isPending) && (
				<UnsavedChangesFooter
					isSaving={saveMutation.isPending}
					errorMessage={saveMutation.error?.message}
					onCancel={resetDraft}
					onSave={handleSave}
				/>
			)}
		</>
	);
}

function MemberBudgetsCard({
	members,
	groups,
	draft,
	currentUserId,
	isLocked,
	isLoading,
	isError,
	onPersonalBudgetChange,
}: {
	members: MemberBudgetRow[];
	groups: MemberBudgetGroup[];
	draft: LimitDraft;
	currentUserId: string | undefined;
	isLocked: boolean;
	isLoading: boolean;
	isError: boolean;
	onPersonalBudgetChange: (userId: string, limitUsd: number | null) => void;
}) {
	const [search, setSearch] = useState('');
	const [groupFilter, setGroupFilter] = useState(ALL_FILTER_VALUE);
	const [usageFilter, setUsageFilter] = useState(ALL_FILTER_VALUE);
	const [sortKey, setSortKey] = useState<SortKey>('spend');
	const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

	const customGroups = useMemo(() => groups.filter((group) => !group.isDefault), [groups]);

	const visibleMembers = useMemo(() => {
		const query = search.trim().toLowerCase();
		const filtered = members.filter((member) => {
			if (query && !member.name.toLowerCase().includes(query) && !member.email.toLowerCase().includes(query)) {
				return false;
			}
			if (groupFilter !== ALL_FILTER_VALUE && !member.groupIds.includes(groupFilter)) {
				return false;
			}
			if (usageFilter === ALL_FILTER_VALUE) {
				return true;
			}
			return getMemberBudgetStatus(member.spendUsd, resolveLimit(member, draft)) === usageFilter;
		});
		return sortMembers(filtered, sortKey, sortDirection, draft);
	}, [members, search, groupFilter, usageFilter, sortKey, sortDirection, draft]);

	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
			return;
		}
		setSortKey(key);
		setSortDirection(key === 'name' ? 'asc' : 'desc');
	}

	return (
		<SettingsCard
			title='Members'
			description='Click a budget to type a value, or use the arrow to pick a preset or go back to the inherited one.'
			action={isLocked ? <UpgradeToEnterprise /> : undefined}
			flush
		>
			<LockedFieldset disabled={isLocked} className='gap-0'>
				<div className='flex flex-wrap items-center gap-2 p-4 border-b border-border'>
					<div className='relative flex-1 min-w-48'>
						<Search className='absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none' />
						<Input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder='Filter by member…'
							className='h-8 pl-8 text-sm'
						/>
					</div>
					{customGroups.length > 0 && (
						<OptionFilter
							label='Filter by group'
							options={[
								{ value: ALL_FILTER_VALUE, label: 'All groups' },
								...customGroups.map((group) => ({ value: group.id, label: group.name })),
							]}
							value={groupFilter}
							onChange={setGroupFilter}
						/>
					)}
					<OptionFilter
						label='Filter by usage'
						options={USAGE_FILTER_OPTIONS}
						value={usageFilter}
						onChange={setUsageFilter}
					/>
				</div>

				<Table className={TABLE_EDGE_PADDING}>
					<TableHeader>
						<TableRow className='[&_th]:h-12'>
							<SortableHead
								label='Member'
								sortKey='name'
								activeKey={sortKey}
								direction={sortDirection}
								onSort={toggleSort}
							/>
							<TableHead>Groups</TableHead>
							<SortableHead
								label={`Usage (${PERIOD_LABELS[draft.period].toLowerCase()} to date)`}
								sortKey='spend'
								activeKey={sortKey}
								direction={sortDirection}
								onSort={toggleSort}
							/>
							<SortableHead
								label='Budget'
								sortKey='limit'
								activeKey={sortKey}
								direction={sortDirection}
								onSort={toggleSort}
							/>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableRow>
								<TableCell colSpan={4} className='text-center text-sm text-muted-foreground h-16'>
									Loading members…
								</TableCell>
							</TableRow>
						) : isError ? (
							<TableRow>
								<TableCell colSpan={4} className='text-center text-sm text-destructive h-16'>
									Failed to load member budgets.
								</TableCell>
							</TableRow>
						) : visibleMembers.length === 0 ? (
							<TableRow>
								<TableCell colSpan={4} className='text-center text-sm text-muted-foreground h-16'>
									No members match these filters.
								</TableCell>
							</TableRow>
						) : (
							visibleMembers.map((member) => {
								const limit = resolveLimit(member, draft);
								const status = getMemberBudgetStatus(member.spendUsd, limit);
								return (
									<TableRow key={member.id}>
										<TableCell>
											<div className='flex flex-col min-w-0'>
												<span className='font-medium truncate'>
													{member.name}
													{member.id === currentUserId && (
														<span className='text-muted-foreground ml-1 font-normal'>
															(you)
														</span>
													)}
												</span>
												<span className='text-xs text-muted-foreground truncate'>
													{member.email}
												</span>
											</div>
										</TableCell>
										<TableCell className='max-w-48'>
											<ResponsiveGroupChips
												size='compact'
												names={listMemberGroupNames(member, groups)}
											/>
										</TableCell>
										<TableCell className='tabular-nums'>
											<span className={cn('text-sm', spendClassName(status))}>
												{isLocked ? '—' : formatUsd(member.spendUsd, 2)}
											</span>
										</TableCell>
										<TableCell>
											<BudgetCell
												limitUsd={limit}
												inherited={{
													source: resolveInheritedSource(member, draft),
													limitUsd: resolveInheritedLimit(member, draft),
												}}
												isInherited={!(member.id in draft.personalBudgets)}
												onChange={(value) => onPersonalBudgetChange(member.id, value)}
											/>
										</TableCell>
									</TableRow>
								);
							})
						)}
					</TableBody>
				</Table>
			</LockedFieldset>
		</SettingsCard>
	);
}

function KpiCard({ value, label, hint }: { value: React.ReactNode; label: string; hint?: string }) {
	const caption = (
		<span className='flex items-center gap-1 text-xs text-muted-foreground'>
			{label}
			{hint && <Info className='size-3' />}
		</span>
	);

	return (
		<div className='flex flex-col gap-1 rounded-xl border border-border bg-background p-4'>
			<div className='flex h-8 items-center text-2xl font-semibold tabular-nums text-foreground'>{value}</div>
			{hint ? (
				<SimpleTooltip content={hint}>
					<span className='w-fit'>{caption}</span>
				</SimpleTooltip>
			) : (
				caption
			)}
		</div>
	);
}

function PeriodPicker({
	period,
	disabled,
	onChange,
}: {
	period: MemberBudgetPeriod;
	disabled: boolean;
	onChange: (period: MemberBudgetPeriod) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type='button'
					aria-label='Budget period'
					disabled={disabled}
					className='-mx-1.5 flex items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60'
				>
					{PERIOD_LABELS[period]}
					<ChevronDown className='size-4 text-muted-foreground' />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start'>
				<DropdownMenuRadioGroup value={period} onValueChange={(value) => onChange(value as MemberBudgetPeriod)}>
					{MEMBER_BUDGET_PERIODS.map((option) => (
						<DropdownMenuRadioItem key={option} value={option} indicator='check'>
							{PERIOD_LABELS[option]}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function OptionFilter({
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: FilterOption[];
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger aria-label={label} className={FILTER_TRIGGER_CLASS_NAME}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function SortableHead({
	label,
	sortKey,
	activeKey,
	direction,
	onSort,
}: {
	label: string;
	sortKey: SortKey;
	activeKey: SortKey;
	direction: SortDirection;
	onSort: (key: SortKey) => void;
}) {
	const isActive = activeKey === sortKey;
	return (
		<TableHead
			onClick={() => onSort(sortKey)}
			aria-sort={isActive ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}
			className='cursor-pointer select-none'
		>
			<div className='flex items-center gap-1'>
				<span>{label}</span>
				<ChevronDown
					size={14}
					className={cn(
						'transition-transform text-muted-foreground',
						isActive ? 'text-foreground' : 'opacity-30',
						isActive && direction === 'asc' && 'rotate-180',
					)}
				/>
			</div>
		</TableHead>
	);
}

function GroupBudgetsTable({
	groups,
	members,
	groupBudgets,
	defaultLimitUsd,
	onGroupBudgetChange,
	onDefaultLimitChange,
}: {
	groups: MemberBudgetGroup[];
	members: MemberBudgetRow[];
	groupBudgets: LimitsById;
	defaultLimitUsd: number;
	onGroupBudgetChange: (groupId: string, limitUsd: number | null) => void;
	onDefaultLimitChange: (limitUsd: number) => void;
}) {
	const memberCountByGroup = countMembersByGroup(members);
	return (
		<Table className={TABLE_EDGE_PADDING}>
			<TableHeader>
				<TableRow className='[&_th]:h-12'>
					<TableHead>Group</TableHead>
					<TableHead>Members</TableHead>
					<TableHead>Budget per member</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{groups.map((group) => (
					<TableRow key={group.id}>
						<TableCell>
							<div className='flex items-center gap-2'>
								<span className='font-medium'>{group.name}</span>
								{group.isDefault && <InlineBadge>Default</InlineBadge>}
							</div>
						</TableCell>
						<TableCell className='tabular-nums'>
							{group.isDefault ? members.length : (memberCountByGroup.get(group.id) ?? 0)}
						</TableCell>
						<TableCell>
							{group.isDefault ? (
								<BudgetCell
									limitUsd={defaultLimitUsd}
									onChange={(value) => onDefaultLimitChange(value ?? 0)}
								/>
							) : (
								<BudgetCell
									limitUsd={groupBudgets[group.id] ?? defaultLimitUsd}
									inherited={{ source: 'default', limitUsd: defaultLimitUsd }}
									isInherited={!(group.id in groupBudgets)}
									onChange={(value) => onGroupBudgetChange(group.id, value)}
								/>
							)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

/** Previews each member's spend over an unsaved period without touching the saved settings. */
function useMembersSpendForPeriod(
	savedMembers: MemberBudgetRow[] | undefined,
	period: MemberBudgetPeriod,
	savedPeriod: MemberBudgetPeriod,
): MemberBudgetRow[] {
	const isPreviewingPeriod = period !== savedPeriod;
	const previewSpend = useQuery({
		...trpc.memberBudget.getSpend.queryOptions({ period }),
		enabled: isPreviewingPeriod,
		placeholderData: keepPreviousData,
	});

	return useMemo(() => {
		const members = savedMembers ?? [];
		if (!isPreviewingPeriod || !previewSpend.data) {
			return members;
		}
		const spendByUser = previewSpend.data;
		return members.map((member) => ({ ...member, spendUsd: spendByUser[member.id] ?? 0 }));
	}, [savedMembers, isPreviewingPeriod, previewSpend.data]);
}

/** Without the license, members and groups are previewed from the user group overview, with no spend. */
function useMemberBudgetOverview(isLicensed: boolean) {
	const overview = useQuery({ ...trpc.memberBudget.getOverview.queryOptions(), enabled: isLicensed });
	const userGroups = useQuery({ ...trpc.userGroup.overview.queryOptions(), enabled: !isLicensed });
	const lockedPreview = useMemo(
		() => (userGroups.data ? buildLockedPreview(userGroups.data) : undefined),
		[userGroups.data],
	);

	if (isLicensed) {
		return overview;
	}
	return { data: lockedPreview, isLoading: userGroups.isLoading, isError: userGroups.isError };
}

function buildLockedPreview(userGroups: UserGroupOverview): MemberBudgetOverview {
	const groupIdsByUser = new Map<string, string[]>();
	for (const { userId, groupId } of [...userGroups.memberships, ...userGroups.ssoMemberships]) {
		groupIdsByUser.set(userId, [...(groupIdsByUser.get(userId) ?? []), groupId]);
	}
	return {
		period: DEFAULT_MEMBER_BUDGET_PERIOD,
		defaultLimitUsd: 0,
		groups: userGroups.groups
			.filter((group) => !group.isLocked)
			.map(({ id, name, isDefault }) => ({ id, name, isDefault, limitUsd: isDefault ? 0 : null })),
		members: userGroups.users.map(({ id, name, email }) => ({
			id,
			name,
			email,
			spendUsd: 0,
			personalLimitUsd: null,
			groupIds: groupIdsByUser.get(id) ?? [],
		})),
	};
}

/** Keeps unsaved edits when the overview refetches without changing the saved draft. */
function useLimitDraft(overview: MemberBudgetOverview | undefined) {
	const savedDraft = useMemo(() => (overview ? buildLimitDraft(overview) : null), [overview]);
	const [draft, setDraft] = useState<LimitDraft>(EMPTY_LIMIT_DRAFT);
	const [syncedDraft, setSyncedDraft] = useState<LimitDraft | null>(null);

	if (savedDraft && !(syncedDraft && areDraftsEqual(savedDraft, syncedDraft))) {
		setSyncedDraft(savedDraft);
		setDraft(savedDraft);
	}

	function resetDraft() {
		if (syncedDraft) {
			setDraft(syncedDraft);
		}
	}

	const isDirty = syncedDraft !== null && !areDraftsEqual(syncedDraft, draft);
	return { draft, savedDraft: syncedDraft, setDraft, isDirty, resetDraft };
}

function buildLimitDraft(overview: MemberBudgetOverview): LimitDraft {
	const personalBudgets: LimitsById = {};
	for (const member of overview.members) {
		if (member.personalLimitUsd !== null) {
			personalBudgets[member.id] = member.personalLimitUsd;
		}
	}
	const groupBudgets: LimitsById = {};
	for (const group of overview.groups) {
		if (!group.isDefault && group.limitUsd !== null) {
			groupBudgets[group.id] = group.limitUsd;
		}
	}
	return { defaultLimitUsd: overview.defaultLimitUsd, personalBudgets, groupBudgets, period: overview.period };
}

function areDraftsEqual(left: LimitDraft, right: LimitDraft): boolean {
	return (
		left.period === right.period &&
		left.defaultLimitUsd === right.defaultLimitUsd &&
		areLimitsEqual(left.personalBudgets, right.personalBudgets) &&
		areLimitsEqual(left.groupBudgets, right.groupBudgets)
	);
}

function areLimitsEqual(left: LimitsById, right: LimitsById): boolean {
	const leftKeys = Object.keys(left);
	if (leftKeys.length !== Object.keys(right).length) {
		return false;
	}
	return leftKeys.every((key) => right[key] === left[key]);
}

function withLimit(limits: LimitsById, id: string, limitUsd: number | null): LimitsById {
	const next = { ...limits };
	if (limitUsd === null) {
		delete next[id];
	} else {
		next[id] = clampLimit(limitUsd);
	}
	return next;
}

function listMemberGroupNames(member: MemberBudgetRow, groups: MemberBudgetGroup[]): string[] {
	return groups.filter((group) => group.isDefault || member.groupIds.includes(group.id)).map((group) => group.name);
}

function countMembersByGroup(members: MemberBudgetRow[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const member of members) {
		for (const groupId of member.groupIds) {
			counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
		}
	}
	return counts;
}

function resolveLimit(member: MemberBudgetRow, draft: LimitDraft): number {
	return resolveMemberBudgetLimit(
		draft.personalBudgets[member.id],
		listGroupLimits(member, draft),
		draft.defaultLimitUsd,
	);
}

function resolveInheritedLimit(member: MemberBudgetRow, draft: LimitDraft): number {
	return resolveMemberBudgetLimit(null, listGroupLimits(member, draft), draft.defaultLimitUsd);
}

function resolveInheritedSource(member: MemberBudgetRow, draft: LimitDraft): InheritedMemberBudgetSource {
	return listGroupLimits(member, draft).length > 0 ? 'group' : 'default';
}

function listGroupLimits(member: MemberBudgetRow, draft: LimitDraft): number[] {
	return member.groupIds
		.filter((groupId) => groupId in draft.groupBudgets)
		.map((groupId) => draft.groupBudgets[groupId]);
}

function sortMembers(
	members: MemberBudgetRow[],
	key: SortKey,
	direction: SortDirection,
	draft: LimitDraft,
): MemberBudgetRow[] {
	const sign = direction === 'asc' ? 1 : -1;
	function limitOf(member: MemberBudgetRow): number {
		return resolveLimit(member, draft);
	}

	return [...members].sort((left, right) => {
		switch (key) {
			case 'name':
				return sign * left.name.localeCompare(right.name);
			case 'spend':
				return sign * (left.spendUsd - right.spendUsd) || left.name.localeCompare(right.name);
			case 'limit':
				return sign * (limitOf(left) - limitOf(right)) || left.name.localeCompare(right.name);
		}
	});
}

function spendClassName(status: MemberBudgetStatus): string {
	if (status === 'exceeded') {
		return 'text-destructive font-medium';
	}
	if (status === 'close') {
		return 'text-amber-500 font-medium';
	}
	return '';
}
