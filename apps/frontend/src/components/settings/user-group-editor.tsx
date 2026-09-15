import {
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	EMPTY_PROJECT_ROW_SECURITY,
	EMPTY_USER_GROUP_ROW_POLICIES,
	EMPTY_USER_GROUP_SSO_MAPPINGS,
	normalizeDatabaseContextAccess,
	normalizeDocsContextAccess,
	normalizeUserGroupRowPolicies,
	normalizeUserGroupSsoMappings,
	USER_GROUP_FEATURE_DEFINITIONS,
} from '@nao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DatabaseContextAccess, DocsContextAccess, UserGroupRowPolicies, UserGroupSsoMappings } from '@nao/shared';
import type { ToolCallDensity } from '@nao/shared/types';
import type { QueryClient } from '@tanstack/react-query';

import type { TabBarItem } from '@/components/ui/tab-bar';
import { ToolCallDensitySlider } from '@/components/settings/tool-call-density-slider';
import { UserGroupContextAccess } from '@/components/settings/user-group-context-access';
import { UserGroupFeatureCard } from '@/components/settings/user-group-feature-card';
import { areUserGroupRowPolicyDraftsValid, UserGroupRowSecurity } from '@/components/settings/user-group-row-security';
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
	isLocked?: false;
	featureGrants: UserGroupFeature[];
	toolCallDensityPolicy: ToolCallDensityPolicy;
	databaseAccess: DatabaseContextAccess;
	docsAccess: DocsContextAccess;
	ssoMappings: UserGroupSsoMappings;
	rowPolicies?: UserGroupRowPolicies;
}

export type UserGroupEditorTab = 'features' | 'context' | 'security' | 'sso';

interface UserGroupEditorProps {
	group: UserGroupEditorGroup | 'new';
	activeTab: UserGroupEditorTab;
	onTabChange: (tab: UserGroupEditorTab) => void;
	onCancelNew: () => void;
	onCreated: (group: UserGroupEditorGroup) => void;
	onDeleted: (groupId: string) => void;
}

const defaultTabs: TabBarItem<UserGroupEditorTab>[] = [
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
	const [rowPolicies, setRowPolicies] = useState<UserGroupRowPolicies>(
		existingGroup?.rowPolicies ?? EMPTY_USER_GROUP_ROW_POLICIES,
	);
	const [formError, setFormError] = useState<string | null>(null);
	const [showRowPolicyValidationErrors, setShowRowPolicyValidationErrors] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const previousGroupRef = useRef(existingGroup);
	const createGroup = useMutation(trpc.userGroup.create.mutationOptions());
	const updateGroup = useMutation(trpc.userGroup.update.mutationOptions());
	const deleteGroup = useMutation(trpc.userGroup.delete.mutationOptions());
	const licenseFeatures = useLicenseFeatures();
	const hasSso = licenseFeatures.data?.sso === true;
	const hasRowLevelSecurity = licenseFeatures.data?.['row-level-security'] === true;
	const rowSecurity = useQuery(trpc.userGroup.rowSecurity.queryOptions());
	const rowSecurityRegistry =
		rowSecurity.data && Array.isArray(rowSecurity.data.tables) ? rowSecurity.data : EMPTY_PROJECT_ROW_SECURITY;
	const oidcConfig = useQuery({
		...trpc.authConfig.oidc.getConfig.queryOptions(),
		enabled: hasSso,
	});
	const microsoftConfig = useQuery({
		...trpc.authConfig.microsoft.isSetup.queryOptions(),
		enabled: hasSso,
	});
	const hasOidc = hasSso && Boolean(oidcConfig.data);
	const hasMicrosoft = hasSso && microsoftConfig.data === true;
	const hasConfiguredSsoProvider = hasOidc || hasMicrosoft;
	const isSsoConfigLoading =
		licenseFeatures.isLoading || (hasSso && (oidcConfig.isLoading || microsoftConfig.isLoading));
	const tabs = hasConfiguredSsoProvider ? [...defaultTabs, { id: 'sso' as const, label: 'SSO' }] : defaultTabs;
	const hasUnsavedChanges =
		existingGroup === null ||
		hasUserGroupEditorChanges(existingGroup, {
			name,
			featureGrants,
			toolCallDensityPolicy,
			databaseAccess,
			docsAccess,
			ssoMappings,
			rowPolicies,
		});

	const resetForm = useCallback(() => {
		setName(existingGroup?.name ?? '');
		setFeatureGrants(existingGroup?.featureGrants ?? []);
		setToolCallDensityPolicy(existingGroup?.toolCallDensityPolicy ?? DEFAULT_TOOL_CALL_DENSITY_POLICY);
		setDatabaseAccess(existingGroup?.databaseAccess ?? EMPTY_DATABASE_CONTEXT_ACCESS);
		setDocsAccess(existingGroup?.docsAccess ?? EMPTY_DOCS_CONTEXT_ACCESS);
		setSsoMappings(existingGroup?.ssoMappings ?? EMPTY_USER_GROUP_SSO_MAPPINGS);
		setRowPolicies(existingGroup?.rowPolicies ?? EMPTY_USER_GROUP_ROW_POLICIES);
		setFormError(null);
		setShowRowPolicyValidationErrors(false);
		setConfirmDelete(false);
	}, [existingGroup]);

	useEffect(() => {
		const previousGroup = previousGroupRef.current;
		previousGroupRef.current = existingGroup;
		const switchedGroups = previousGroup?.id !== existingGroup?.id;
		const previousGroupWasClean =
			previousGroup !== null &&
			!hasUserGroupEditorChanges(previousGroup, {
				name,
				featureGrants,
				toolCallDensityPolicy,
				databaseAccess,
				docsAccess,
				ssoMappings,
				rowPolicies,
			});

		if (switchedGroups || previousGroupWasClean) {
			resetForm();
		}
	}, [
		databaseAccess,
		docsAccess,
		existingGroup,
		featureGrants,
		name,
		resetForm,
		rowPolicies,
		ssoMappings,
		toolCallDensityPolicy,
	]);

	useEffect(() => {
		if (activeTab === 'sso' && !isSsoConfigLoading && !hasConfiguredSsoProvider) {
			onTabChange('features');
		}
	}, [activeTab, hasConfiguredSsoProvider, isSsoConfigLoading, onTabChange]);

	const handleSave = async () => {
		setFormError(null);
		if (hasRowLevelSecurity && !areUserGroupRowPolicyDraftsValid(rowSecurityRegistry, rowPolicies)) {
			setShowRowPolicyValidationErrors(true);
			onTabChange('security');
			return;
		}
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
					...(hasRowLevelSecurity ? { rowPolicies } : {}),
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
					...(hasRowLevelSecurity ? { rowPolicies } : {}),
				});
				await invalidateUserGroupQueries(queryClient);
				onCreated(createdGroup);
			}
			setShowRowPolicyValidationErrors(false);
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
			setShowRowPolicyValidationErrors(false);
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
							<UserGroupRowSecurity
								registry={rowSecurityRegistry}
								policies={rowPolicies}
								isLicensed={hasRowLevelSecurity}
								showValidationErrors={showRowPolicyValidationErrors}
								onChange={setRowPolicies}
							/>
						)}
						{activeTab === 'sso' && hasConfiguredSsoProvider && (
							<div className='flex flex-col gap-5'>
								{existingGroup?.isDefault ? (
									<p className='rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground'>
										All Users already includes everyone with project access and cannot be mapped.
									</p>
								) : (
									<>
										{hasOidc && oidcConfig.data && (
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
										{hasMicrosoft && (
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
		rowPolicies?: UserGroupRowPolicies;
	},
): boolean {
	return (
		(!group.isDefault && values.name.trim() !== group.name.trim()) ||
		!haveSameItems(values.featureGrants, group.featureGrants) ||
		values.toolCallDensityPolicy.defaultDensity !== group.toolCallDensityPolicy.defaultDensity ||
		values.toolCallDensityPolicy.canChange !== group.toolCallDensityPolicy.canChange ||
		!haveSameDatabaseAccess(values.databaseAccess, group.databaseAccess) ||
		!haveSameDocsAccess(values.docsAccess ?? group.docsAccess, group.docsAccess) ||
		!haveSameSsoMappings(values.ssoMappings ?? group.ssoMappings, group.ssoMappings) ||
		!haveSameRowPolicies(
			values.rowPolicies ?? group.rowPolicies ?? EMPTY_USER_GROUP_ROW_POLICIES,
			group.rowPolicies ?? EMPTY_USER_GROUP_ROW_POLICIES,
		)
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

function haveSameRowPolicies(left: UserGroupRowPolicies, right: UserGroupRowPolicies): boolean {
	try {
		return (
			JSON.stringify(normalizeUserGroupRowPolicies(left)) === JSON.stringify(normalizeUserGroupRowPolicies(right))
		);
	} catch {
		return false;
	}
}
