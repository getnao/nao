import {
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	normalizeDatabaseContextAccess,
	USER_GROUP_FEATURE_DEFINITIONS,
} from '@nao/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { DatabaseContextAccess } from '@nao/shared';
import type { ToolCallDensity } from '@nao/shared/types';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { TabBarItem } from '@/components/ui/tab-bar';
import { ToolCallDensitySlider } from '@/components/settings/tool-call-density-slider';
import { UserGroupContextAccess } from '@/components/settings/user-group-context-access';
import { UserGroupFeatureCard } from '@/components/settings/user-group-feature-card';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { trpc } from '@/main';

type UserGroupFeature = (typeof USER_GROUP_FEATURE_DEFINITIONS)[number]['key'];

interface ToolCallDensityPolicy {
	defaultDensity: ToolCallDensity;
	canChange: boolean;
}

export interface UserGroupEditorGroup {
	id: string;
	name: string;
	isDefault: boolean;
	featureGrants: UserGroupFeature[];
	toolCallDensityPolicy: ToolCallDensityPolicy;
	databaseAccess: DatabaseContextAccess;
}

export type UserGroupEditorTab = 'features' | 'context' | 'security';

interface UserGroupEditorProps {
	group: UserGroupEditorGroup | 'new';
	activeTab: UserGroupEditorTab;
	onTabChange: (tab: UserGroupEditorTab) => void;
	onCancelNew: () => void;
	onCreated: (group: UserGroupEditorGroup) => void;
	onDeleted: (groupId: string) => void;
}

const tabs: TabBarItem<UserGroupEditorTab>[] = [
	{ id: 'features', label: 'Features' },
	{ id: 'context', label: 'Context' },
	{ id: 'security', label: 'Security' },
];

export function UserGroupEditor({
	group,
	activeTab,
	onTabChange,
	onCancelNew,
	onCreated,
	onDeleted,
}: UserGroupEditorProps) {
	const queryClient = useQueryClient();
	const existingGroup = group === 'new' ? null : group;
	const [name, setName] = useState(existingGroup?.name ?? '');
	const [featureGrants, setFeatureGrants] = useState<UserGroupFeature[]>(existingGroup?.featureGrants ?? []);
	const [toolCallDensityPolicy, setToolCallDensityPolicy] = useState<ToolCallDensityPolicy>(
		existingGroup?.toolCallDensityPolicy ?? DEFAULT_TOOL_CALL_DENSITY_POLICY,
	);
	const [databaseAccess, setDatabaseAccess] = useState<DatabaseContextAccess>(
		existingGroup?.databaseAccess ?? EMPTY_DATABASE_CONTEXT_ACCESS,
	);
	const [formError, setFormError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const createGroup = useMutation(trpc.userGroup.create.mutationOptions());
	const updateGroup = useMutation(trpc.userGroup.update.mutationOptions());
	const deleteGroup = useMutation(trpc.userGroup.delete.mutationOptions());
	const hasUnsavedChanges =
		existingGroup === null ||
		hasUserGroupEditorChanges(existingGroup, {
			name,
			featureGrants,
			toolCallDensityPolicy,
			databaseAccess,
		});

	const resetForm = useCallback(() => {
		setName(existingGroup?.name ?? '');
		setFeatureGrants(existingGroup?.featureGrants ?? []);
		setToolCallDensityPolicy(existingGroup?.toolCallDensityPolicy ?? DEFAULT_TOOL_CALL_DENSITY_POLICY);
		setDatabaseAccess(existingGroup?.databaseAccess ?? EMPTY_DATABASE_CONTEXT_ACCESS);
		setFormError(null);
		setConfirmDelete(false);
	}, [existingGroup]);

	useEffect(() => {
		resetForm();
	}, [resetForm]);

	const handleSave = async () => {
		setFormError(null);
		try {
			if (existingGroup) {
				await updateGroup.mutateAsync({
					groupId: existingGroup.id,
					...(existingGroup.isDefault ? {} : { name }),
					featureGrants,
					toolCallDensityPolicy,
					databaseAccess,
				});
				await invalidateUserGroupQueries(queryClient);
			} else {
				const createdGroup = await createGroup.mutateAsync({
					name,
					featureGrants,
					toolCallDensityPolicy,
					databaseAccess,
				});
				await invalidateUserGroupQueries(queryClient);
				onCreated(createdGroup);
			}
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
			onDeleted(existingGroup.id);
		} catch (error) {
			setConfirmDelete(false);
			setFormError(error instanceof Error ? error.message : 'Failed to delete the group.');
		}
	};

	const handleCancel = () => {
		if (group === 'new') {
			onCancelNew();
			return;
		}
		resetForm();
	};

	return (
		<>
			<div className='flex min-w-0 flex-1 flex-col gap-6'>
				<div className='flex max-w-xl flex-col gap-2'>
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
						tabs={tabs}
						activeTab={activeTab}
						onTabChange={onTabChange}
						idBase='user-group-editor'
						className='border-b'
					/>
					<TabPanel idBase='user-group-editor' tabId={activeTab} className='pt-5'>
						{activeTab === 'features' && (
							<UserGroupFeatures
								featureGrants={featureGrants}
								onFeatureGrantsChange={setFeatureGrants}
								toolCallDensityPolicy={toolCallDensityPolicy}
								onToolCallDensityPolicyChange={setToolCallDensityPolicy}
							/>
						)}
						{activeTab === 'context' && (
							<UserGroupContextAccess
								databaseAccess={databaseAccess}
								onDatabaseAccessChange={setDatabaseAccess}
							/>
						)}
						{activeTab === 'security' && (
							<UserGroupPlaceholder>Row-level security will be configured here.</UserGroupPlaceholder>
						)}
					</TabPanel>
				</div>
				{formError && <p className='text-sm text-destructive'>{formError}</p>}
				<div className='flex flex-wrap justify-between gap-2'>
					{existingGroup && !existingGroup.isDefault ? (
						<Button variant='destructive' className='rounded-full' onClick={() => setConfirmDelete(true)}>
							Delete group
						</Button>
					) : (
						<span />
					)}
					{hasUnsavedChanges && (
						<div className='ml-auto flex gap-2'>
							<Button variant='ghost' className='rounded-full border' onClick={handleCancel}>
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
					)}
				</div>
			</div>

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

export function hasUserGroupEditorChanges(
	group: UserGroupEditorGroup,
	values: {
		name: string;
		featureGrants: UserGroupFeature[];
		toolCallDensityPolicy: ToolCallDensityPolicy;
		databaseAccess: DatabaseContextAccess;
	},
): boolean {
	return (
		(!group.isDefault && values.name.trim() !== group.name.trim()) ||
		!haveSameItems(values.featureGrants, group.featureGrants) ||
		values.toolCallDensityPolicy.defaultDensity !== group.toolCallDensityPolicy.defaultDensity ||
		values.toolCallDensityPolicy.canChange !== group.toolCallDensityPolicy.canChange ||
		!haveSameDatabaseAccess(values.databaseAccess, group.databaseAccess)
	);
}

export function invalidateUserGroupQueries(queryClient: QueryClient) {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: trpc.userGroup.overview.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.userGroup.effectiveAccess.queryKey() }),
	]);
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

function haveSameItems<T>(left: T[], right: T[]): boolean {
	const leftItems = new Set(left);
	const rightItems = new Set(right);
	return leftItems.size === rightItems.size && [...leftItems].every((item) => rightItems.has(item));
}

function haveSameDatabaseAccess(left: DatabaseContextAccess, right: DatabaseContextAccess): boolean {
	return (
		JSON.stringify(normalizeDatabaseContextAccess(left)) === JSON.stringify(normalizeDatabaseContextAccess(right))
	);
}

function UserGroupPlaceholder({ children }: { children: ReactNode }) {
	return (
		<div className='flex min-h-64 items-center justify-center rounded-lg border border-dashed p-6 text-sm text-muted-foreground'>
			{children}
		</div>
	);
}
