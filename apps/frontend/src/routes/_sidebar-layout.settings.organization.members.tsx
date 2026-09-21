import { createFileRoute } from '@tanstack/react-router';

import { OrgMembers } from '@/components/settings/org-members';
import { SettingsPageWrapper } from '@/components/ui/settings-card';

export const Route = createFileRoute('/_sidebar-layout/settings/organization/members')({
	component: OrganizationMembersPage,
});

function OrganizationMembersPage() {
	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Members</h1>
					<p className='text-sm text-muted-foreground'>
						These are people in your organization, and they may not belong to every project.
					</p>
				</div>
				<div className='flex flex-col gap-12'>
					<OrgMembers />
				</div>
			</div>
		</SettingsPageWrapper>
	);
}
