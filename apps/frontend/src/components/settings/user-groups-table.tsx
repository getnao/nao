import { DEFAULT_TOOL_CALL_DENSITY_POLICY, USER_GROUP_FEATURE_DEFINITIONS } from '@nao/shared';
import { USER_ROLE_LABELS } from '@nao/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MemberStatus, ToolCallDensity, UserRole } from '@nao/shared/types';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ToolCallDensitySlider } from '@/components/settings/tool-call-density-slider';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { UserGroupFeatureCard } from '@/components/settings/user-group-feature-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { Switch } from '@/components/ui/switch';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLicenseFeatures } from '@/hooks/use-license';
import { calculateVisibleGroupChipCount } from '@/lib/user-group-chip-overflow';
import { trpc } from '@/main';

type UserGroupFeature = (typeof USER_GROUP_FEATURE_DEFINITIONS)[number]['key'];

interface ToolCallDensityPolicy {
	defaultDensity: ToolCallDensity;
	canChange: boolean;
}

interface UserGroup {
	id: string;
	name: string;
	isDefault: boolean;
	featureGrants: UserGroupFeature[];
	toolCallDensityPolicy: ToolCallDensityPolicy;
}

type ProjectAccessSource = 'project' | 'organization' | 'both';
type UserGroupDialogTab = 'features' | 'context' | 'security';

interface UserWithProjectAccess {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	status: MemberStatus;
	source: ProjectAccessSource;
}

const USER_GROUP_DIALOG_TABS: Array<{ id: UserGroupDialogTab; label: string }> = [
	{ id: 'features', label: 'Features' },
	{ id: 'context', label: 'Context' },
	{ id: 'security', label: 'Security' },
];

function invalidateUserGroupQueries(queryClient: QueryClient) {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: trpc.userGroup.overview.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.userGroup.effectiveAccess.queryKey() }),
	]);
}

export function UserGroupsTable() {
	const licenseFeatures = useLicenseFeatures();

	if (licenseFeatures.isLoading) {
		return <div className='text-sm text-muted-foreground'>Loading User Groups...</div>;
	}
	if (licenseFeatures.isError) {
		return <div className='text-sm text-destructive'>Failed to load license features.</div>;
	}
	if (!licenseFeatures.data?.['user-groups']) {
		return (
			<SettingsCard
				description='Control which product features project users can access.'
				action={<UpgradeToEnterprise />}
			>
				<p className='text-sm text-muted-foreground'>User Groups is available with nao Enterprise.</p>
			</SettingsCard>
		);
	}

	return <LicensedUserGroupsTable />;
}

function LicensedUserGroupsTable() {
	const overview = useQuery(trpc.userGroup.overview.queryOptions());
	const [editingGroup, setEditingGroup] = useState<UserGroup | 'new' | null>(null);
	const membershipKeys = useMemo(
		() => new Set(overview.data?.memberships.map(({ groupId, userId }) => `${groupId}:${userId}`)),
		[overview.data?.memberships],
	);

	if (overview.isLoading) {
		return <div className='text-sm text-muted-foreground'>Loading groups...</div>;
	}
	if (overview.isError) {
		return <div className='text-sm text-destructive'>Failed to load User Groups.</div>;
	}
	if (!overview.data) {
		return null;
	}

	const projectUsers = overview.data.users.filter((user) => user.source !== 'organization');
	const organizationUsers = overview.data.users.filter((user) => user.source === 'organization');

	return (
		<>
			<SettingsCard
				description='Assign project users to groups and configure the features each group allows.'
				action={<UserGroupActions groups={overview.data.groups} onEdit={setEditingGroup} />}
				flush
			>
				<UserAccessTable
					projectUsers={projectUsers}
					organizationUsers={organizationUsers}
					groups={overview.data.groups}
					membershipKeys={membershipKeys}
				/>
			</SettingsCard>

			<UserGroupDialog
				group={editingGroup}
				onOpenChange={(open) => {
					if (!open) {
						setEditingGroup(null);
					}
				}}
			/>
		</>
	);
}

function UserGroupActions({ groups, onEdit }: { groups: UserGroup[]; onEdit: (group: UserGroup | 'new') => void }) {
	return (
		<div className='flex items-center gap-2'>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size='sm' variant='outline'>
						Manage groups
						<ChevronDown />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='max-h-64 min-w-52'>
					{groups.map((group) => (
						<DropdownMenuItem key={group.id} onSelect={() => onEdit(group)}>
							<Pencil />
							{group.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			<Button size='sm' onClick={() => onEdit('new')}>
				<Plus />
				Create group
			</Button>
		</div>
	);
}

function UserAccessTable({
	projectUsers,
	organizationUsers,
	groups,
	membershipKeys,
}: {
	projectUsers: UserWithProjectAccess[];
	organizationUsers: UserWithProjectAccess[];
	groups: UserGroup[];
	membershipKeys: Set<string>;
}) {
	const hasUsers = projectUsers.length > 0 || organizationUsers.length > 0;

	return (
		<div className='overflow-x-auto'>
			<Table className='min-w-3xl'>
				<TableHeader>
					<TableRow className='[&_th]:h-12'>
						<TableHead className='min-w-64'>User</TableHead>
						<TableHead className='min-w-36'>Role</TableHead>
						<TableHead className='min-w-52'>Groups</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{!hasUsers && (
						<TableRow>
							<TableCell colSpan={3} className='h-24 text-center'>
								No users have access to this project.
							</TableCell>
						</TableRow>
					)}
					{projectUsers.length > 0 && (
						<UserAccessSection
							label='Project Team'
							users={projectUsers}
							groups={groups}
							membershipKeys={membershipKeys}
						/>
					)}
					{organizationUsers.length > 0 && (
						<UserAccessSection
							label='Organisation Members'
							users={organizationUsers}
							groups={groups}
							membershipKeys={membershipKeys}
						/>
					)}
				</TableBody>
			</Table>
		</div>
	);
}

function UserAccessSection({
	label,
	users,
	groups,
	membershipKeys,
}: {
	label: string;
	users: UserWithProjectAccess[];
	groups: UserGroup[];
	membershipKeys: Set<string>;
}) {
	return (
		<>
			<TableRow className='border-y bg-muted/40 hover:bg-muted/40'>
				<TableCell colSpan={3} className='py-2.5 text-xs font-semibold text-muted-foreground'>
					{label}
				</TableCell>
			</TableRow>
			{users.map((user) => (
				<TableRow key={user.id}>
					<TableCell>
						<div className='flex flex-col'>
							<span className='font-medium'>{user.name}</span>
							<span className='text-xs text-muted-foreground'>
								{user.email}
								{user.status ? ` · ${user.status}` : ''}
							</span>
						</div>
					</TableCell>
					<TableCell>
						<Badge variant={user.role}>{USER_ROLE_LABELS[user.role]}</Badge>
					</TableCell>
					<TableCell>
						<UserGroupsCell user={user} groups={groups} membershipKeys={membershipKeys} />
					</TableCell>
				</TableRow>
			))}
		</>
	);
}

function UserGroupsCell({
	user,
	groups,
	membershipKeys,
}: {
	user: UserWithProjectAccess;
	groups: UserGroup[];
	membershipKeys: Set<string>;
}) {
	const queryClient = useQueryClient();
	const setMembership = useMutation(
		trpc.userGroup.setMembership.mutationOptions({
			onSuccess: () => invalidateUserGroupQueries(queryClient),
		}),
	);
	const selectedGroupNames = useMemo(
		() =>
			groups
				.filter((group) => group.isDefault || membershipKeys.has(`${group.id}:${user.id}`))
				.map((group) => group.name),
		[groups, membershipKeys, user.id],
	);
	const selectedGroupLabel = selectedGroupNames.length > 0 ? selectedGroupNames.join(', ') : 'No groups';

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant='outline'
					size='sm'
					className='h-8 w-full min-w-0 justify-between overflow-hidden bg-background font-normal'
					aria-label={`Manage groups for ${user.name}. Current groups: ${selectedGroupLabel}`}
					title={selectedGroupLabel}
				>
					<ResponsiveGroupChips names={selectedGroupNames} />
					<ChevronDown className='shrink-0' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' className='max-h-64 min-w-56'>
				{groups.map((group) => (
					<DropdownMenuCheckboxItem
						key={group.id}
						checked={group.isDefault || membershipKeys.has(`${group.id}:${user.id}`)}
						disabled={group.isDefault || setMembership.isPending}
						onSelect={(event) => event.preventDefault()}
						onCheckedChange={(checked) =>
							setMembership.mutate({
								groupId: group.id,
								userId: user.id,
								isMember: checked === true,
							})
						}
					>
						{group.name}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ResponsiveGroupChips({ names }: { names: string[] }) {
	const labelAreaRef = useRef<HTMLSpanElement>(null);
	const measurementRef = useRef<HTMLSpanElement>(null);
	const [visibleCount, setVisibleCount] = useState(0);

	const measure = useCallback(() => {
		const labelArea = labelAreaRef.current;
		const measurement = measurementRef.current;
		if (!labelArea || !measurement) {
			return;
		}

		const groupChipWidths = Array.from(
			measurement.querySelectorAll<HTMLElement>('[data-measure-group]'),
			(element) => element.getBoundingClientRect().width,
		);
		const overflowChipWidths = Array<number>(names.length + 1);
		for (const element of measurement.querySelectorAll<HTMLElement>('[data-measure-overflow]')) {
			overflowChipWidths[Number(element.dataset.measureOverflow)] = element.getBoundingClientRect().width;
		}
		const gap = Number.parseFloat(getComputedStyle(measurement).columnGap) || 0;
		setVisibleCount(
			calculateVisibleGroupChipCount({
				availableWidth: labelArea.getBoundingClientRect().width,
				groupChipWidths,
				overflowChipWidths,
				gap,
			}),
		);
	}, [names]);

	useLayoutEffect(() => {
		measure();
		const labelArea = labelAreaRef.current;
		const measurement = measurementRef.current;
		if (!labelArea || !measurement) {
			return;
		}

		const observer = new ResizeObserver(measure);
		observer.observe(labelArea);
		observer.observe(measurement);
		return () => observer.disconnect();
	}, [measure]);

	const safeVisibleCount = Math.min(visibleCount, names.length);
	const hiddenCount = names.length - safeVisibleCount;

	return (
		<span ref={labelAreaRef} className='relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden'>
			{names.length === 0 ? (
				<GroupNameChip name='No groups' />
			) : (
				<>
					{names.slice(0, safeVisibleCount).map((name, index) => (
						<GroupNameChip key={`${name}-${index}`} name={name} />
					))}
					{hiddenCount > 0 && <GroupNameChip name={`+${hiddenCount}`} />}
				</>
			)}
			<span
				ref={measurementRef}
				aria-hidden
				className='invisible absolute left-0 top-0 flex w-max items-center gap-1 pointer-events-none'
			>
				{names.map((name, index) => (
					<GroupNameChip key={`measure-${name}-${index}`} name={name} measure='group' />
				))}
				{names.map((_, index) => {
					const hidden = index + 1;
					return <GroupNameChip key={`measure-overflow-${hidden}`} name={`+${hidden}`} measure={hidden} />;
				})}
			</span>
		</span>
	);
}

function GroupNameChip({ name, measure }: { name: string; measure?: 'group' | number }) {
	return (
		<Badge
			variant='secondary'
			className='h-5 px-1.5 py-0 text-[10px] font-normal'
			data-measure-group={measure === 'group' ? '' : undefined}
			data-measure-overflow={typeof measure === 'number' ? measure : undefined}
		>
			{name}
		</Badge>
	);
}

function UserGroupDialog({
	group,
	onOpenChange,
}: {
	group: UserGroup | 'new' | null;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const existingGroup = group === 'new' ? null : group;
	const [name, setName] = useState('');
	const [featureGrants, setFeatureGrants] = useState<UserGroupFeature[]>([]);
	const [toolCallDensityPolicy, setToolCallDensityPolicy] = useState<ToolCallDensityPolicy>(
		DEFAULT_TOOL_CALL_DENSITY_POLICY,
	);
	const [formError, setFormError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [activeTab, setActiveTab] = useState<UserGroupDialogTab>('features');
	const createGroup = useMutation(trpc.userGroup.create.mutationOptions());
	const updateGroup = useMutation(trpc.userGroup.update.mutationOptions());
	const deleteGroup = useMutation(trpc.userGroup.delete.mutationOptions());

	useEffect(() => {
		setName(existingGroup?.name ?? '');
		setFeatureGrants(existingGroup?.featureGrants ?? []);
		setToolCallDensityPolicy(existingGroup?.toolCallDensityPolicy ?? DEFAULT_TOOL_CALL_DENSITY_POLICY);
		setFormError(null);
		setConfirmDelete(false);
		setActiveTab('features');
	}, [existingGroup, group]);

	const handleSave = async () => {
		setFormError(null);
		try {
			if (existingGroup) {
				await updateGroup.mutateAsync({
					groupId: existingGroup.id,
					...(existingGroup.isDefault ? {} : { name }),
					featureGrants,
					toolCallDensityPolicy,
				});
			} else {
				await createGroup.mutateAsync({ name, featureGrants, toolCallDensityPolicy });
			}
			await invalidateUserGroupQueries(queryClient);
			onOpenChange(false);
		} catch (error) {
			setFormError(error instanceof Error ? error.message : 'Failed to save the group.');
		}
	};

	const handleDelete = async () => {
		if (!existingGroup || existingGroup.isDefault) {
			return;
		}
		try {
			await deleteGroup.mutateAsync({ groupId: existingGroup.id });
			await invalidateUserGroupQueries(queryClient);
			setConfirmDelete(false);
			onOpenChange(false);
		} catch (error) {
			setConfirmDelete(false);
			setFormError(error instanceof Error ? error.message : 'Failed to delete the group.');
		}
	};

	return (
		<>
			<Dialog open={group !== null} onOpenChange={onOpenChange}>
				<DialogContent className='sm:max-w-3xl'>
					<DialogHeader>
						<DialogTitle>{existingGroup ? `Edit ${existingGroup.name}` : 'Create group'}</DialogTitle>
					</DialogHeader>
					<div className='flex flex-col gap-6'>
						<div className='flex flex-col gap-2'>
							<label htmlFor='user-group-name' className='text-sm font-medium'>
								Group name
							</label>
							<Input
								id='user-group-name'
								value={name}
								onChange={(event) => setName(event.target.value)}
								disabled={existingGroup?.isDefault}
								required
								maxLength={80}
							/>
						</div>
						<div>
							<TabBar
								tabs={USER_GROUP_DIALOG_TABS}
								activeTab={activeTab}
								onTabChange={setActiveTab}
								idBase='user-group-dialog'
								className='border-b'
							/>
							<TabPanel idBase='user-group-dialog' tabId={activeTab} className='min-h-80 pt-5'>
								{activeTab === 'features' && (
									<UserGroupFeatures
										featureGrants={featureGrants}
										onFeatureGrantsChange={setFeatureGrants}
										toolCallDensityPolicy={toolCallDensityPolicy}
										onToolCallDensityPolicyChange={setToolCallDensityPolicy}
									/>
								)}
								{activeTab === 'context' && (
									<UserGroupPlaceholder>
										Table and file access will be configured here.
									</UserGroupPlaceholder>
								)}
								{activeTab === 'security' && (
									<UserGroupPlaceholder>
										Row-level security will be configured here.
									</UserGroupPlaceholder>
								)}
							</TabPanel>
						</div>
						{formError && <p className='text-sm text-destructive'>{formError}</p>}
						<div className='flex justify-between gap-2'>
							{existingGroup && !existingGroup.isDefault ? (
								<Button
									variant='destructive'
									className='rounded-full'
									onClick={() => setConfirmDelete(true)}
								>
									Delete group
								</Button>
							) : (
								<span />
							)}
							<div className='flex gap-2'>
								<Button
									variant='ghost'
									className='rounded-full border'
									onClick={() => onOpenChange(false)}
								>
									Cancel
								</Button>
								<Button
									variant='primary-gradient'
									className='rounded-full'
									onClick={handleSave}
									disabled={!existingGroup?.isDefault && name.trim().length === 0}
									isLoading={createGroup.isPending || updateGroup.isPending}
								>
									Save
								</Button>
							</div>
						</div>
					</div>
				</DialogContent>
			</Dialog>

			<ConfirmationDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title={`Delete ${existingGroup?.name}?`}
				description='This removes the group and all of its user memberships.'
				confirmLabel='Delete'
				onConfirm={handleDelete}
				isPending={deleteGroup.isPending}
				preventCloseWhilePending
			/>
		</>
	);
}

function UserGroupFeatures({
	featureGrants,
	onFeatureGrantsChange,
	toolCallDensityPolicy,
	onToolCallDensityPolicyChange,
}: {
	featureGrants: UserGroupFeature[];
	onFeatureGrantsChange: (featureGrants: UserGroupFeature[]) => void;
	toolCallDensityPolicy: ToolCallDensityPolicy;
	onToolCallDensityPolicyChange: (policy: ToolCallDensityPolicy) => void;
}) {
	return (
		<div className='flex flex-col gap-6'>
			<div className='flex flex-col gap-3'>
				<div>
					<h3 className='text-sm font-medium'>Allowed features</h3>
					<p className='text-xs text-muted-foreground'>Choose which product features this group can use.</p>
				</div>
				<div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
					{USER_GROUP_FEATURE_DEFINITIONS.map((feature) => (
						<UserGroupFeatureCard
							key={feature.key}
							feature={feature}
							selected={featureGrants.includes(feature.key)}
							onSelectedChange={(selected) =>
								onFeatureGrantsChange(
									selected
										? [...featureGrants, feature.key]
										: featureGrants.filter((key) => key !== feature.key),
								)
							}
						/>
					))}
				</div>
			</div>

			<div className='flex flex-col gap-3 border-t pt-5'>
				<div>
					<h3 className='text-sm font-medium'>Tool call density</h3>
					<p className='text-xs text-muted-foreground'>Set how tool calls appear for this group.</p>
				</div>
				<div className='flex items-center justify-between gap-4 rounded-lg border p-3'>
					<div>
						<p className='text-sm font-medium'>Default density</p>
						<p className='text-xs text-muted-foreground'>
							{toolCallDensityPolicy.canChange
								? 'Members start with this setting.'
								: 'Members always use this setting.'}
						</p>
					</div>
					<ToolCallDensitySlider
						value={toolCallDensityPolicy.defaultDensity}
						onValueChange={(defaultDensity) =>
							onToolCallDensityPolicyChange({ ...toolCallDensityPolicy, defaultDensity })
						}
					/>
				</div>
				<UserGroupSwitchRow
					id='user-group-density-can-change'
					label='Let members choose'
					description='Members can override the default in their account settings.'
					checked={toolCallDensityPolicy.canChange}
					onCheckedChange={(canChange) =>
						onToolCallDensityPolicyChange({ ...toolCallDensityPolicy, canChange })
					}
				/>
			</div>
		</div>
	);
}

function UserGroupSwitchRow({
	id,
	label,
	description,
	checked,
	onCheckedChange,
}: {
	id: string;
	label: string;
	description: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<div className='flex items-start justify-between gap-4 rounded-lg border p-3'>
			<div>
				<label htmlFor={id} className='text-sm font-medium'>
					{label}
				</label>
				<p className='text-xs text-muted-foreground'>{description}</p>
			</div>
			<Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
		</div>
	);
}

function UserGroupPlaceholder({ children }: { children: ReactNode }) {
	return (
		<div className='flex min-h-64 items-center justify-center rounded-lg border border-dashed p-6 text-sm text-muted-foreground'>
			{children}
		</div>
	);
}
