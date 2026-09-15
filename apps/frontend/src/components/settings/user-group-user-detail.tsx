import { EMPTY_PROJECT_ROW_SECURITY, resolveWarehouseRowSecurity, USER_GROUP_FEATURE_DEFINITIONS } from '@nao/shared';
import { USER_ROLE_LABELS } from '@nao/shared/types';
import type { MemberStatus, UserRole } from '@nao/shared/types';
import type {
	DatabaseContextAccess,
	DocsContextAccess,
	ProjectRowSecurity,
	ToolCallDensityPolicy,
	UserGroupFeature,
	UserGroupRowPolicies,
	WarehouseRowSecurity,
} from '@nao/shared';

import type { DatabaseContextObject } from '@/components/settings/user-group-context-access';
import type { DocsContextCatalogEntry } from '@/components/settings/user-group-docs-context-access';
import type { UserGroupEditorGroup } from '@/components/settings/user-group-editor';
import { ResponsiveGroupChips } from '@/components/settings/user-group-chips';
import { getEffectiveUserGroupAccessSummary } from '@/components/settings/user-group-access-summary';
import { UserGroupEffectiveContext } from '@/components/settings/user-group-effective-context';
import { UserGroupFeatureSummaryCard } from '@/components/settings/user-group-feature-card';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { useLicenseFeatures } from '@/hooks/use-license';

interface UserGroupDetailUser {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	status: MemberStatus;
}

interface EffectiveUserGroupAccess {
	features: Record<UserGroupFeature, boolean>;
	toolCallDensityPolicy: ToolCallDensityPolicy;
	databaseAccess: DatabaseContextAccess;
	docsAccess: DocsContextAccess;
	rowPolicies: UserGroupRowPolicies[];
}

export type UserGroupUserDetailTab = 'features' | 'context' | 'security';

interface UserGroupUserDetailProps {
	user: UserGroupDetailUser;
	groups: UserGroupEditorGroup[];
	memberships: Array<{ groupId: string; userId: string }>;
	effectiveAccess: EffectiveUserGroupAccess;
	contextObjects: DatabaseContextObject[];
	docsEntries: DocsContextCatalogEntry[];
	databaseSyncState?: 'missing' | 'ready';
	docsSyncState?: 'missing' | 'ready';
	databaseCatalogState?: 'loading' | 'error' | 'ready';
	docsCatalogState?: 'loading' | 'error' | 'ready';
	onRetryDatabaseCatalog?: () => void;
	onRetryDocsCatalog?: () => void;
	projectRowSecurity?: ProjectRowSecurity;
	securityState?: 'loading' | 'error' | 'ready';
	onRetrySecurity?: () => void;
	activeTab: UserGroupUserDetailTab;
	onTabChange: (tab: UserGroupUserDetailTab) => void;
}

const tabs = [
	{ id: 'features', label: 'Features' },
	{ id: 'context', label: 'Context' },
	{ id: 'security', label: 'Security' },
] satisfies Array<{ id: UserGroupUserDetailTab; label: string }>;

export function UserGroupUserDetail({
	user,
	groups,
	memberships,
	effectiveAccess,
	contextObjects,
	docsEntries,
	databaseSyncState,
	docsSyncState,
	databaseCatalogState = 'ready',
	docsCatalogState = 'ready',
	onRetryDatabaseCatalog,
	onRetryDocsCatalog,
	projectRowSecurity = EMPTY_PROJECT_ROW_SECURITY,
	securityState = 'ready',
	onRetrySecurity,
	activeTab,
	onTabChange,
}: UserGroupUserDetailProps) {
	const membershipGroupIds = new Set(
		memberships.filter((membership) => membership.userId === user.id).map((membership) => membership.groupId),
	);
	const applicableGroups = groups.filter((group) => group.isDefault || membershipGroupIds.has(group.id));
	const applicableGroupNames = applicableGroups.map((group) => group.name);
	const accessSummary =
		databaseCatalogState === 'ready' &&
		docsCatalogState === 'ready' &&
		databaseSyncState === 'ready' &&
		docsSyncState === 'ready'
			? getEffectiveUserGroupAccessSummary(effectiveAccess, contextObjects, docsEntries)
			: undefined;

	return (
		<div className='flex flex-col gap-6'>
			<header className='flex flex-col gap-2'>
				<h2 className='text-lg font-semibold text-foreground'>{user.name}</h2>
				<div className='flex flex-wrap items-center gap-2'>
					<span className='text-sm text-muted-foreground'>{user.email}</span>
					<Badge variant={user.status === 'active' ? 'success' : 'secondary'}>
						{user.status === 'active' ? 'Active' : 'Invited'}
					</Badge>
					<Badge variant={user.role}>{USER_ROLE_LABELS[user.role]}</Badge>
				</div>
			</header>

			<section className='flex min-w-0 flex-col gap-3'>
				<div>
					<h3 className='text-sm font-medium'>Groups</h3>
					<p className='text-xs text-muted-foreground'>Groups that contribute to this user&apos;s access.</p>
				</div>
				<div className='flex min-w-0 flex-col gap-2'>
					<ResponsiveGroupChips names={applicableGroupNames} />
					{accessSummary && <p className='text-sm text-muted-foreground'>{accessSummary}</p>}
				</div>
			</section>

			<section>
				<div className='mb-3'>
					<h3 className='text-sm font-medium'>Combined access</h3>
					<p className='text-xs text-muted-foreground'>Effective access from all applicable groups.</p>
				</div>
				<TabBar
					tabs={tabs}
					activeTab={activeTab}
					onTabChange={onTabChange}
					idBase='user-group-user-detail'
					className='border-b'
				/>
				<TabPanel idBase='user-group-user-detail' tabId={activeTab} className='pt-5'>
					{activeTab === 'features' && <EffectiveFeatures access={effectiveAccess} />}
					{activeTab === 'context' && (
						<UserGroupEffectiveContext
							databaseAccess={effectiveAccess.databaseAccess}
							docsAccess={effectiveAccess.docsAccess}
							contextObjects={contextObjects}
							docsEntries={docsEntries}
							databaseSyncState={databaseSyncState}
							docsSyncState={docsSyncState}
							databaseCatalogState={databaseCatalogState}
							docsCatalogState={docsCatalogState}
							onRetryDatabaseCatalog={onRetryDatabaseCatalog}
							onRetryDocsCatalog={onRetryDocsCatalog}
						/>
					)}
					{activeTab === 'security' && (
						<EffectiveRowSecurity
							projectRowSecurity={projectRowSecurity}
							groupPolicies={effectiveAccess.rowPolicies}
							state={securityState}
							onRetry={onRetrySecurity}
						/>
					)}
				</TabPanel>
			</section>
		</div>
	);
}

function EffectiveFeatures({ access }: { access: EffectiveUserGroupAccess }) {
	return (
		<div className='flex flex-col gap-5'>
			<div className='flex flex-col gap-3'>
				<div>
					<h4 className='text-sm font-medium'>Allowed features</h4>
					<p className='text-xs text-muted-foreground'>
						Effective feature access from all applicable groups.
					</p>
				</div>
				<div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
					{USER_GROUP_FEATURE_DEFINITIONS.map((feature) => (
						<UserGroupFeatureSummaryCard
							key={feature.key}
							feature={feature}
							allowed={access.features[feature.key]}
						/>
					))}
				</div>
			</div>

			<div className='flex flex-col gap-3 border-t pt-5'>
				<div>
					<h4 className='text-sm font-medium'>Tool call density</h4>
					<p className='text-xs text-muted-foreground'>Resolved from this user&apos;s applicable groups.</p>
				</div>
				<dl className='rounded-lg border'>
					<div className='flex min-h-11 items-center justify-between gap-4 border-b px-3 py-2 last:border-b-0'>
						<dt className='text-sm text-muted-foreground'>Default density</dt>
						<dd>
							<Badge variant='secondary'>
								{getDensityLabel(access.toolCallDensityPolicy.defaultDensity)}
							</Badge>
						</dd>
					</div>
					<div className='flex min-h-11 items-center justify-between gap-4 px-3 py-2'>
						<dt className='text-sm text-muted-foreground'>Member may change it</dt>
						<dd>
							<Badge variant='secondary'>{access.toolCallDensityPolicy.canChange ? 'Yes' : 'No'}</Badge>
						</dd>
					</div>
				</dl>
			</div>
		</div>
	);
}

function getDensityLabel(density: ToolCallDensityPolicy['defaultDensity']): string {
	return density === 'compact' ? 'Compact' : 'Detailed';
}

function EffectiveRowSecurity({
	projectRowSecurity,
	groupPolicies,
	state,
	onRetry,
}: {
	projectRowSecurity: ProjectRowSecurity;
	groupPolicies: UserGroupRowPolicies[];
	state: 'loading' | 'error' | 'ready';
	onRetry?: () => void;
}) {
	const license = useLicenseFeatures();
	const isLicensed = license.data?.['row-level-security'] === true;

	return (
		<div className='flex min-w-0 flex-col gap-3'>
			<div>
				<h4 className='text-sm font-medium'>Effective row-level security</h4>
				<p className='text-xs text-muted-foreground'>
					Combined from all applicable groups. Group filters are joined with OR.
				</p>
			</div>
			{license.isLoading ? (
				<SecurityStatus message='Checking row-level security license...' />
			) : license.isError || !license.data ? (
				<SecurityStatus message='Unable to verify row-level security enforcement.' />
			) : !isLicensed ? (
				<div className='flex items-start justify-between gap-4 rounded-lg border px-3 py-3'>
					<div className='min-w-0'>
						<p className='text-sm font-medium'>Enterprise feature inactive</p>
						<p className='text-xs text-muted-foreground'>No row filters are currently enforced.</p>
					</div>
					<UpgradeToEnterprise />
				</div>
			) : state === 'loading' ? (
				<SecurityStatus message='Loading row-level security...' />
			) : state === 'error' ? (
				<SecurityStatus message='Failed to load row-level security' onRetry={onRetry} />
			) : (
				<ResolvedRowSecurity security={resolveWarehouseRowSecurity(projectRowSecurity, groupPolicies)} />
			)}
		</div>
	);
}

function SecurityStatus({ message, onRetry }: { message: string; onRetry?: () => void }) {
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

function ResolvedRowSecurity({ security }: { security: WarehouseRowSecurity }) {
	if (!security.enforced) {
		return (
			<div className='rounded-lg border px-3 py-3 text-sm text-muted-foreground'>
				No protected tables configured.
			</div>
		);
	}

	return (
		<div className='min-w-0 divide-y rounded-lg border'>
			{security.tables.map((table) => (
				<div
					key={`${table.databaseType}/${table.database}/${table.schema}/${table.table}`}
					className='flex min-w-0 flex-col gap-2 px-3 py-3'
				>
					<div className='flex min-w-0 items-center justify-between gap-3'>
						<p className='min-w-0 truncate text-sm font-medium'>
							{table.database}/{table.schema}/{table.table}
						</p>
						<RowSecurityStatusBadge access={table.access} />
					</div>
					{table.access === 'predicate' && (
						<pre className='max-w-full overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground'>
							WHERE {table.predicate}
						</pre>
					)}
				</div>
			))}
		</div>
	);
}

function RowSecurityStatusBadge({
	access,
}: {
	access: Extract<WarehouseRowSecurity, { enforced: true }>['tables'][number]['access'];
}) {
	if (access === 'predicate') {
		return <Badge variant='success'>Filtered</Badge>;
	}
	if (access === 'full') {
		return <Badge variant='secondary'>Full access</Badge>;
	}
	return <Badge className='bg-accent text-accent-foreground'>No rows</Badge>;
}
