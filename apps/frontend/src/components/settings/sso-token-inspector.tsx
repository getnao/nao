/* @license Enterprise */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { USER_ROLE_LABELS } from '@nao/shared/types';

import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

type Inspection = NonNullable<ReturnType<typeof useInspection>['data']>;

const PROBLEM_HINTS: Record<string, string> = {
	'no-token': 'This user has never signed in through single sign-on, so there is no token to read.',
	undecodable: 'The stored token could not be decoded. The user should sign out and back in.',
	'claim-missing':
		'The identity provider did not send this claim in the ID token. Check the claim name and that it is included in the ID token, not only in the userinfo endpoint.',
	'no-group-matched':
		'The claim was present but none of its groups appear in OIDC_GROUP_ROLE_MAPPING, so this user can no longer sign in through SSO.',
};

export function SsoTokenInspector() {
	const { data: session } = useSession();
	const oidc = useQuery(trpc.authConfig.oidc.getConfig.queryOptions());
	const members = useQuery(trpc.project.listAllUsersWithRoles.queryOptions());
	const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined);

	const selectedUserIsMember = members.data?.some((member) => member.id === selectedUserId);
	const userId = members.data
		? selectedUserIsMember
			? selectedUserId
			: session?.user?.id
		: (selectedUserId ?? session?.user?.id);
	const inspection = useInspection(userId);

	if (!oidc.data) {
		return null;
	}

	return (
		<SettingsCard
			title='Single sign-on token'
			description={`Shows the claims ${oidc.data.providerName} sent at the selected user's last sign-in, and how they resolved to a role.`}
			action={
				<Select value={userId} onValueChange={setSelectedUserId}>
					<SelectTrigger size='sm' className='w-56'>
						<SelectValue placeholder='Select a user' />
					</SelectTrigger>
					<SelectContent>
						{(members.data ?? []).map((member) => (
							<SelectItem key={member.id} value={member.id}>
								{member.email}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			}
		>
			{inspection.isLoading && <p className='text-sm text-muted-foreground'>Reading token…</p>}
			{inspection.isError && <p className='text-sm text-destructive'>{inspection.error.message}</p>}
			{inspection.data && <InspectionResult inspection={inspection.data} />}
		</SettingsCard>
	);
}

function InspectionResult({ inspection }: { inspection: Inspection }) {
	const hint = inspection.problem ? PROBLEM_HINTS[inspection.problem] : null;

	return (
		<div className='flex flex-col gap-4'>
			{hint && (
				<p className='text-sm text-yellow-600 dark:text-yellow-500 bg-yellow-500/5 border border-yellow-500/30 rounded-lg p-3'>
					{hint}
				</p>
			)}

			<div className='flex flex-col gap-2'>
				<Row label='Claim read'>
					<code className='font-mono text-xs'>{inspection.claimName}</code>
				</Row>
				<Row label='Groups received'>
					<GroupBadges groups={inspection.groups} matched={inspection.matchedGroups} />
				</Row>
				<Row label='Resolved role'>
					{inspection.resolvedRole ? (
						<Badge variant={inspection.resolvedRole}>{USER_ROLE_LABELS[inspection.resolvedRole]}</Badge>
					) : (
						<span className='text-sm text-muted-foreground'>No mapped group matched</span>
					)}
				</Row>
				<Row label='Token issued'>
					<span className='text-sm'>
						{inspection.issuedAt ? new Date(inspection.issuedAt).toLocaleString() : '—'}
					</span>
				</Row>
			</div>

			{inspection.claims && (
				<details className='rounded-lg border border-border'>
					<summary className='cursor-pointer px-3 py-2 text-sm font-medium'>Raw ID token claims</summary>
					<pre className='overflow-x-auto border-t border-border px-3 py-2 font-mono text-xs'>
						{JSON.stringify(inspection.claims, null, 2)}
					</pre>
				</details>
			)}
		</div>
	);
}

function GroupBadges({ groups, matched }: { groups: string[]; matched: string[] }) {
	if (groups.length === 0) {
		return <span className='text-sm text-muted-foreground'>None</span>;
	}

	const matchedSet = new Set(matched);
	return (
		<div className='flex flex-wrap justify-end gap-1'>
			{groups.map((group) => (
				<Badge key={group} variant={matchedSet.has(group) ? 'admin' : 'ghost'} className='font-mono text-xs'>
					{group}
				</Badge>
			))}
		</div>
	);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className='flex items-start justify-between gap-4'>
			<span className='text-sm text-muted-foreground shrink-0'>{label}</span>
			<div className='text-right min-w-0'>{children}</div>
		</div>
	);
}

function useInspection(userId: string | undefined) {
	return useQuery({
		...trpc.authConfig.oidc.inspectToken.queryOptions({ userId }),
		enabled: !!userId,
	});
}
