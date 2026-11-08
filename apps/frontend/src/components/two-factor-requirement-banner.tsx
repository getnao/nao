import { useNavigate, useRouterState } from '@tanstack/react-router';
import { ShieldAlert } from 'lucide-react';

import { formatTwoFactorDeadline } from '@/components/settings/two-factor-types';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { useTwoFactorRequirement } from '@/hooks/use-two-factor-requirement';

const ACCOUNT_SETTINGS_PATH = '/settings/account';

export function TwoFactorRequirementBanner() {
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const { requirement } = useTwoFactorRequirement();

	if (!requirement || requirement.isOverdue || pathname === ACCOUNT_SETTINGS_PATH) {
		return null;
	}

	return (
		<Callout
			variant='warning'
			icon={ShieldAlert}
			className='items-center rounded-none border-x-0 border-t-0 px-4 py-2 text-sm'
			role='status'
		>
			<div className='flex min-h-8 flex-wrap items-center gap-3'>
				<div className='min-w-0 flex-1'>
					<span className='font-medium text-foreground'>
						Your organization requires two-factor authentication.
					</span>{' '}
					<span className='text-muted-foreground'>
						Set it up before {formatTwoFactorDeadline(requirement.deadline)} to keep using the app.
					</span>
				</div>
				<Button size='sm' onClick={() => navigate({ to: ACCOUNT_SETTINGS_PATH })}>
					Set up
				</Button>
			</div>
		</Callout>
	);
}
