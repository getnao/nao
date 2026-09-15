import {
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	EMPTY_PROJECT_ROW_SECURITY,
	EMPTY_USER_GROUP_ROW_POLICIES,
	EMPTY_USER_GROUP_SSO_MAPPINGS,
	extractConditionalGroupContent,
	filterProjectRowSecurityByDatabaseContext,
	filterUserGroupRowPoliciesByDatabaseContext,
	normalizeDatabaseContextAccess,
	normalizeDocsContextAccess,
	normalizeUserGroupRowPolicies,
	normalizeUserGroupSsoMappings,
	USER_GROUP_FEATURE_DEFINITIONS,
} from '@nao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
	const existingRowPolicies = useMemo(
		() =>
			existingGroup
				? filterUserGroupRowPoliciesByDatabaseContext(
						existingGroup.rowPolicies ?? EMPTY_USER_GROUP_ROW_POLICIES,
						existingGroup.databaseAccess,
					)
				: EMPTY_USER_GROUP_ROW_POLICIES,
		[existingGroup],
	);
	const editorGroup = useMemo(
		() => (existingGroup ? { ...existingGroup, rowPolicies: existingRowPolicies } : null),
		[existingGroup, existingRowPolicies],
	);
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
	const [rowPolicies, setRowPolicies] = useState<UserGroupRowPolicies>(existingRowPolicies);
	const [formError, setFormError] = useState<string | null>(null);
	const [showRowPolicyValidationErrors, setShowRowPolicyValidationErrors] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const previousGroupRef = useRef(editorGroup);
	const createGroup = useMutation(trpc.userGroup.create.mutationOptions());
	const updateGroup = useMutation(trpc.userGroup.update.mutationOptions());
	const deleteGroup = useMutation(trpc.userGroup.delete.mutationOptions());
	const licenseFeatures = useLicenseFeatures();
	const hasSso = licenseFeatures.data?.sso === true;
	const hasRowLevelSecurity = licenseFeatures.data?.['row-level-security'] === true;
	const rowSecurity = useQuery(trpc.userGroup.rowSecurity.queryOptions());
	const rowSecurityState = rowSecurity.isLoading ? 'loading' : rowSecurity.isError ? 'error' : 'ready';
	const rowSecurityRegistry =
		rowSecurity.data && Array.isArray(rowSecurity.data.tables) ? rowSecurity.data : EMPTY_PROJECT_ROW_SECURITY;
	const accessibleRowSecurityRegistry = filterProjectRowSecurityByDatabaseContext(
		rowSecurityRegistry,
		databaseAccess,
	);
	const needsRowSecurityMetadata =
		hasRowLevelSecurity && rowPolicies.policies.some((policy) => policy.access === 'predicate');
	const oidcConfig = useQuery({
		...trpc.authConfig.oidc.getConfig.queryOptions(),
		enabled: hasSso,
	});
	const microsoftConfig = useQuery({
		...trpc.authConfig.microsoft.isSetup.queryOptions(),
		enabled: hasSso,
	});
	const ssoLicenseState = licenseFeatures.isLoading
		? 'loading'
		: licenseFeatures.isError
			? 'error'
			: hasSso
				? 'ready'
				: 'unavailable';
	const oidcConfigurationState = resolveSsoConfigurationState(
		ssoLicenseState,
		oidcConfig,
		oidcConfig.data !== null && oidcConfig.data !== undefined,
	);
	const microsoftConfigurationState = resolveSsoConfigurationState(
		ssoLicenseState,
		microsoftConfig,
		microsoftConfig.data === true,
	);
	const hasStoredOidcMappings = ssoMappings.providers.oidc.length > 0;
	const hasStoredMicrosoftMappings = ssoMappings.providers.microsoft.length > 0;
	const hasConfiguredSsoProvider = oidcConfigurationState === 'ready' || microsoftConfigurationState === 'ready';
	const isSsoConfigLoading =
		ssoLicenseState === 'loading' ||
		oidcConfigurationState === 'loading' ||
		microsoftConfigurationState === 'loading';
	const hasSsoTab = hasConfiguredSsoProvider;
	const tabs = hasSsoTab ? [...defaultTabs, { id: 'sso' as const, label: 'SSO' }] : defaultTabs;
	const hasUnsavedChanges =
		editorGroup === null ||
		hasUserGroupEditorChanges(editorGroup, {
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
		setRowPolicies(existingRowPolicies);
		setFormError(null);
		setShowRowPolicyValidationErrors(false);
		setConfirmDelete(false);
	}, [existingGroup, existingRowPolicies]);

	useEffect(() => {
		const previousGroup = previousGroupRef.current;
		previousGroupRef.current = editorGroup;
		const switchedGroups = previousGroup?.id !== editorGroup?.id;
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
		editorGroup,
		featureGrants,
		name,
		resetForm,
		rowPolicies,
		ssoMappings,
		toolCallDensityPolicy,
	]);

	useEffect(() => {
		if (activeTab === 'sso' && !isSsoConfigLoading && !hasSsoTab) {
			onTabChange('features');
		}
	}, [activeTab, hasSsoTab, isSsoConfigLoading, onTabChange]);

	const handleDatabaseAccessChange = (nextAccess: DatabaseContextAccess) => {
		const normalizedAccess = normalizeDatabaseContextAccess(nextAccess);
		setDatabaseAccess(normalizedAccess);
		setRowPolicies((current) => filterUserGroupRowPoliciesByDatabaseContext(current, normalizedAccess));
	};

	const handleSave = async () => {
		setFormError(null);
		if (needsRowSecurityMetadata && rowSecurityState !== 'ready') {
			onTabChange('security');
			return;
		}
		if (hasRowLevelSecurity && !areUserGroupRowPolicyDraftsValid(accessibleRowSecurityRegistry, rowPolicies)) {
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
	const retrySsoConfiguration = (configuration: { refetch: () => unknown }) =>
		void (ssoLicenseState === 'error' ? licenseFeatures.refetch() : configuration.refetch());

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
									onDatabaseAccessChange={handleDatabaseAccessChange}
									onDocsAccessChange={setDocsAccess}
								/>
								<ConditionalRulesHelp groupName={name} />
							</div>
						)}
						{activeTab === 'security' && (
							<>
								{hasRowLevelSecurity && rowSecurityState === 'loading' ? (
									<RowSecurityStatus message='Loading row-level security...' />
								) : hasRowLevelSecurity && rowSecurityState === 'error' ? (
									<RowSecurityStatus
										message='Failed to load row-level security'
										onRetry={() => void rowSecurity.refetch()}
									/>
								) : (
									<UserGroupRowSecurity
										registry={rowSecurityRegistry}
										databaseAccess={databaseAccess}
										policies={rowPolicies}
										isLicensed={hasRowLevelSecurity}
										showValidationErrors={showRowPolicyValidationErrors}
										onChange={setRowPolicies}
									/>
								)}
							</>
						)}
						{activeTab === 'sso' && (hasSsoTab || isSsoConfigLoading) && (
							<div className='flex flex-col gap-5'>
								{existingGroup?.isDefault ? (
									<DefaultGroupSsoStatus
										licenseState={ssoLicenseState}
										oidcState={oidcConfigurationState}
										microsoftState={microsoftConfigurationState}
										onRetryOidc={() => retrySsoConfiguration(oidcConfig)}
										onRetryMicrosoft={() => retrySsoConfiguration(microsoftConfig)}
									/>
								) : (
									<>
										{ssoLicenseState !== 'ready' && (
											<SsoAvailabilityStatus
												state={ssoLicenseState}
												onRetry={() => void licenseFeatures.refetch()}
											/>
										)}
										{ssoLicenseState === 'ready' &&
											!hasConfiguredSsoProvider &&
											isSsoConfigLoading && (
												<p className='text-sm text-muted-foreground'>
													Loading SSO configuration...
												</p>
											)}
										{hasConfiguredSsoProvider && (
											<>
												{(hasStoredOidcMappings ||
													oidcConfigurationState !== 'unavailable') && (
													<UserGroupSsoMapping
														key={`${existingGroup?.id ?? 'new'}:oidc`}
														identifiers={ssoMappings.providers.oidc}
														provider='oidc'
														providerName={oidcConfig.data?.providerName ?? 'OIDC'}
														configurationState={oidcConfigurationState}
														onRetryConfiguration={() => retrySsoConfiguration(oidcConfig)}
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
												{(hasStoredMicrosoftMappings ||
													microsoftConfigurationState !== 'unavailable') && (
													<UserGroupSsoMapping
														key={`${existingGroup?.id ?? 'new'}:microsoft`}
														identifiers={ssoMappings.providers.microsoft}
														provider='microsoft'
														providerName='Microsoft Entra'
														configurationState={microsoftConfigurationState}
														onRetryConfiguration={() =>
															retrySsoConfiguration(microsoftConfig)
														}
														onChange={(microsoft) =>
															setSsoMappings(
																normalizeUserGroupSsoMappings({
																	...ssoMappings,
																	providers: {
																		...ssoMappings.providers,
																		microsoft,
																	},
																}),
															)
														}
													/>
												)}
											</>
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

function RowSecurityStatus({ message, onRetry }: { message: string; onRetry?: () => void }) {
	return (
		<div className='flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2'>
			<p className='text-sm text-muted-foreground'>{message}</p>
			{onRetry && (
				<Button type='button' size='sm' variant='outline' className='rounded-full' onClick={onRetry}>
					Retry
				</Button>
			)}
		</div>
	);
}

type SsoConfigurationState = 'ready' | 'loading' | 'error' | 'unavailable';

function resolveSsoConfigurationState(
	licenseState: SsoConfigurationState,
	query: { isLoading: boolean; isError: boolean },
	isConfigured: boolean,
): SsoConfigurationState {
	if (licenseState !== 'ready') {
		return licenseState;
	}
	if (query.isLoading) {
		return 'loading';
	}
	if (query.isError) {
		return 'error';
	}
	return isConfigured ? 'ready' : 'unavailable';
}

function SsoAvailabilityStatus({
	state,
	onRetry,
}: {
	state: Exclude<SsoConfigurationState, 'ready'>;
	onRetry: () => void;
}) {
	if (state === 'unavailable') {
		return null;
	}
	return (
		<div className='flex items-center justify-between gap-3 rounded-lg border p-3'>
			<p className={state === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
				{state === 'loading' ? 'Loading SSO availability...' : 'Failed to load SSO availability.'}
			</p>
			{state === 'error' && (
				<Button type='button' variant='outline' size='sm' onClick={onRetry}>
					Retry
				</Button>
			)}
		</div>
	);
}

function DefaultGroupSsoStatus({
	licenseState,
	oidcState,
	microsoftState,
	onRetryOidc,
	onRetryMicrosoft,
}: {
	licenseState: SsoConfigurationState;
	oidcState: SsoConfigurationState;
	microsoftState: SsoConfigurationState;
	onRetryOidc: () => void;
	onRetryMicrosoft: () => void;
}) {
	if (licenseState === 'loading') {
		return <p className='text-sm text-muted-foreground'>Loading SSO availability...</p>;
	}
	if (oidcState === 'loading' || microsoftState === 'loading') {
		return <p className='text-sm text-muted-foreground'>Loading SSO configuration...</p>;
	}
	if (oidcState === 'error' || microsoftState === 'error') {
		return (
			<div className='flex flex-wrap items-center gap-2 rounded-lg border p-3'>
				<p className='mr-auto text-sm text-destructive'>
					{licenseState === 'error'
						? 'Failed to load SSO availability.'
						: 'Failed to load SSO configuration.'}
				</p>
				{oidcState === 'error' && (
					<Button type='button' variant='outline' size='sm' onClick={onRetryOidc}>
						Retry OIDC
					</Button>
				)}
				{microsoftState === 'error' && (
					<Button type='button' variant='outline' size='sm' onClick={onRetryMicrosoft}>
						Retry Microsoft Entra
					</Button>
				)}
			</div>
		);
	}
	if (oidcState !== 'ready' && microsoftState !== 'ready') {
		return null;
	}
	return (
		<p className='rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground'>
			All Users already includes everyone with project access and cannot be mapped.
		</p>
	);
}

export function ConditionalRulesHelp({ groupName }: { groupName: string }) {
	const { isCopied, copy } = useCopyToClipboard();
	const normalizedName = groupName.trim();
	const rulesFile = useQuery(trpc.contextExplorer.readFile.queryOptions({ path: 'RULES.md' }));
	const groupSpecificRules = useMemo(() => {
		if (!normalizedName || !rulesFile.data?.content) {
			return '';
		}
		try {
			return extractConditionalGroupContent(rulesFile.data.content, normalizedName);
		} catch {
			return '';
		}
	}, [normalizedName, rulesFile.data?.content]);
	const exampleSnippet = normalizedName
		? `{% if group(${JSON.stringify(normalizedName)}) %}\nGroup-specific instructions...\n{% endif %}`
		: null;
	const snippet = groupSpecificRules || exampleSnippet;

	return (
		<section className='flex min-w-0 flex-col gap-3 border-t pt-5'>
			<div>
				<h3 className='text-sm font-medium'>Conditional Rules</h3>
				{normalizedName && !rulesFile.isLoading && (
					<p className='text-xs text-muted-foreground'>
						{groupSpecificRules
							? 'This group has specific rules in RULES.md.'
							: 'Add a conditional block to RULES.md to give this group specific rules.'}
					</p>
				)}
			</div>
			{!normalizedName ? (
				<p className='text-xs text-muted-foreground'>Enter a group name to generate a snippet.</p>
			) : rulesFile.isLoading ? (
				<p className='text-xs text-muted-foreground'>Loading RULES.md...</p>
			) : snippet ? (
				<div className='relative min-w-0 rounded-md bg-muted p-3 pr-12'>
					<pre className='whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]'>
						<code>{snippet}</code>
					</pre>
					<Button
						type='button'
						variant='ghost'
						size='icon-sm'
						className='absolute right-2 top-2'
						aria-label='Copy conditional rules snippet'
						onClick={() => void copy(snippet)}
					>
						{isCopied ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
					</Button>
				</div>
			) : null}
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
