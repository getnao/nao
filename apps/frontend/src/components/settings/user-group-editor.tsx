import {
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	EMPTY_USER_GROUP_SSO_MAPPINGS,
	normalizeDatabaseContextAccess,
	normalizeDocsContextAccess,
	normalizeUserGroupSsoMappings,
	USER_GROUP_FEATURE_DEFINITIONS,
} from '@nao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, FolderOpen } from 'lucide-react';
import type { DatabaseContextAccess, DocsContextAccess, UserGroupSsoMappings } from '@nao/shared';
import type { ToolCallDensity } from '@nao/shared/types';
import type { QueryClient } from '@tanstack/react-query';

import type { TabBarItem } from '@/components/ui/tab-bar';
import { ToolCallDensitySlider } from '@/components/settings/tool-call-density-slider';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { UserGroupContextAccess } from '@/components/settings/user-group-context-access';
import { UserGroupFeatureCard } from '@/components/settings/user-group-feature-card';
import { UserGroupSsoMapping } from '@/components/settings/user-group-sso-mapping';
import { UserGroupSwitchRow } from '@/components/settings/user-group-switch-row';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Input } from '@/components/ui/input';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useLicenseFeatures } from '@/hooks/use-license';
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
	docsAccess: DocsContextAccess;
	ssoMappings: UserGroupSsoMappings;
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
	const [docsAccess, setDocsAccess] = useState<DocsContextAccess>(
		existingGroup?.docsAccess ?? EMPTY_DOCS_CONTEXT_ACCESS,
	);
	const [ssoMappings, setSsoMappings] = useState<UserGroupSsoMappings>(
		existingGroup?.ssoMappings ?? EMPTY_USER_GROUP_SSO_MAPPINGS,
	);
	const [formError, setFormError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const createGroup = useMutation(trpc.userGroup.create.mutationOptions());
	const updateGroup = useMutation(trpc.userGroup.update.mutationOptions());
	const deleteGroup = useMutation(trpc.userGroup.delete.mutationOptions());
	const licenseFeatures = useLicenseFeatures();
	const hasSso = licenseFeatures.data?.sso === true;
	const hasRowLevelSecurity = licenseFeatures.data?.['row-level-security'] === true;
	const oidcConfig = useQuery({
		...trpc.authConfig.oidc.getConfig.queryOptions(),
		enabled: hasSso,
	});
	const microsoftConfig = useQuery({
		...trpc.authConfig.microsoft.isSetup.queryOptions(),
		enabled: hasSso,
	});
	const hasUnsavedChanges =
		existingGroup === null ||
		hasUserGroupEditorChanges(existingGroup, {
			name,
			featureGrants,
			toolCallDensityPolicy,
			databaseAccess,
			docsAccess,
			ssoMappings,
		});

	const resetForm = useCallback(() => {
		setName(existingGroup?.name ?? '');
		setFeatureGrants(existingGroup?.featureGrants ?? []);
		setToolCallDensityPolicy(existingGroup?.toolCallDensityPolicy ?? DEFAULT_TOOL_CALL_DENSITY_POLICY);
		setDatabaseAccess(existingGroup?.databaseAccess ?? EMPTY_DATABASE_CONTEXT_ACCESS);
		setDocsAccess(existingGroup?.docsAccess ?? EMPTY_DOCS_CONTEXT_ACCESS);
		setSsoMappings(existingGroup?.ssoMappings ?? EMPTY_USER_GROUP_SSO_MAPPINGS);
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
					docsAccess,
					ssoMappings,
				});
				await invalidateUserGroupQueries(queryClient);
			} else {
				const createdGroup = await createGroup.mutateAsync({
					name,
					featureGrants,
					toolCallDensityPolicy,
					databaseAccess,
					docsAccess,
					ssoMappings,
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
							<div className='flex flex-col gap-5'>
								<UserGroupContextAccess
									databaseAccess={databaseAccess}
									docsAccess={docsAccess}
									onDatabaseAccessChange={setDatabaseAccess}
									onDocsAccessChange={setDocsAccess}
								/>
								<ConditionalRulesHelp groupName={name} />
							</div>
						)}
						{activeTab === 'security' && (
							<div className='flex flex-col gap-5'>
								{existingGroup?.isDefault && (oidcConfig.data || microsoftConfig.data) ? (
									<p className='rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground'>
										All Users already includes everyone with project access and cannot be mapped.
									</p>
								) : (
									<>
										{oidcConfig.data && (
											<UserGroupSsoMapping
												identifiers={ssoMappings.providers.oidc}
												provider='oidc'
												providerName={oidcConfig.data.providerName}
												onChange={(oidc) =>
													setSsoMappings(
														normalizeUserGroupSsoMappings({
															...ssoMappings,
															providers: { ...ssoMappings.providers, oidc },
														}),
													)
												}
											/>
										)}
										{microsoftConfig.data && (
											<UserGroupSsoMapping
												identifiers={ssoMappings.providers.microsoft}
												provider='microsoft'
												providerName='Microsoft Entra'
												onChange={(microsoft) =>
													setSsoMappings(
														normalizeUserGroupSsoMappings({
															...ssoMappings,
															providers: { ...ssoMappings.providers, microsoft },
														}),
													)
												}
											/>
										)}
									</>
								)}
								<RowLevelSecurityPlaceholder isLicensed={hasRowLevelSecurity} />
							</div>
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

export function ConditionalRulesHelp({ groupName }: { groupName: string }) {
	const { isCopied, copy } = useCopyToClipboard();
	const normalizedName = groupName.trim();
	const snippet = normalizedName
		? `{% if group(${JSON.stringify(normalizedName)}) %}\nGroup-specific instructions...\n{% endif %}`
		: null;

	return (
		<section className='flex flex-col gap-3 rounded-lg border p-4'>
			<div>
				<h3 className='text-sm font-medium'>Conditional RULES</h3>
				<p className='text-xs text-muted-foreground'>
					In the project-root RULES.md, this block is included for members of any named group.
				</p>
			</div>
			{snippet ? (
				<div className='relative rounded-md bg-muted p-3 pr-12'>
					<pre className='overflow-x-auto text-xs'>
						<code>{snippet}</code>
					</pre>
					<Button
						type='button'
						variant='ghost'
						size='icon-sm'
						className='absolute right-2 top-2'
						aria-label='Copy conditional RULES snippet'
						onClick={() => void copy(snippet)}
					>
						{isCopied ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
					</Button>
				</div>
			) : (
				<p className='text-xs text-muted-foreground'>Enter a group name to generate a snippet.</p>
			)}
			<Button asChild type='button' variant='outline' size='sm' className='w-fit'>
				<a href='/settings/context-explorer'>
					<FolderOpen className='size-3.5' />
					Open File Explorer
				</a>
			</Button>
		</section>
	);
}

export function hasUserGroupEditorChanges(
	group: UserGroupEditorGroup,
	values: {
		name: string;
		featureGrants: UserGroupFeature[];
		toolCallDensityPolicy: ToolCallDensityPolicy;
		databaseAccess: DatabaseContextAccess;
		docsAccess?: DocsContextAccess;
		ssoMappings?: UserGroupSsoMappings;
	},
): boolean {
	return (
		(!group.isDefault && values.name.trim() !== group.name.trim()) ||
		!haveSameItems(values.featureGrants, group.featureGrants) ||
		values.toolCallDensityPolicy.defaultDensity !== group.toolCallDensityPolicy.defaultDensity ||
		values.toolCallDensityPolicy.canChange !== group.toolCallDensityPolicy.canChange ||
		!haveSameDatabaseAccess(values.databaseAccess, group.databaseAccess) ||
		!haveSameDocsAccess(values.docsAccess ?? group.docsAccess, group.docsAccess) ||
		!haveSameSsoMappings(values.ssoMappings ?? group.ssoMappings, group.ssoMappings)
	);
}

export function invalidateUserGroupQueries(queryClient: QueryClient) {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: trpc.userGroup.overview.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.userGroup.effectiveAccess.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.userGroup.effectiveAccessForUser.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.project.getDatabaseObjects.queryKey() }),
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

function haveSameDocsAccess(left: DocsContextAccess, right: DocsContextAccess): boolean {
	return JSON.stringify(normalizeDocsContextAccess(left)) === JSON.stringify(normalizeDocsContextAccess(right));
}

function haveSameSsoMappings(left: UserGroupSsoMappings, right: UserGroupSsoMappings): boolean {
	return JSON.stringify(normalizeUserGroupSsoMappings(left)) === JSON.stringify(normalizeUserGroupSsoMappings(right));
}

function RowLevelSecurityPlaceholder({ isLicensed }: { isLicensed: boolean }) {
	return (
		<section className='flex flex-col gap-3 rounded-lg border border-dashed p-4'>
			<div className='flex items-start justify-between gap-3'>
				<div>
					<h3 className='text-sm font-medium'>Row-level security</h3>
					<p className='mt-1 text-xs text-muted-foreground'>
						Restricting which rows each group can access is not available yet.
					</p>
				</div>
				{!isLicensed && <UpgradeToEnterprise />}
			</div>
		</section>
	);
}
