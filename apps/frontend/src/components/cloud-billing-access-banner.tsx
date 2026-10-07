import { useQuery } from '@tanstack/react-query';
import { Clock3, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { useOpenOrganizationBilling } from '@/hooks/use-open-organization-billing';
import { trpc } from '@/main';

const TRIAL_WARNING_MS = 3 * 24 * 60 * 60 * 1000;

export function CloudBillingAccessBanner() {
	const openOrganizationBilling = useOpenOrganizationBilling();
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const access = useQuery({
		...trpc.billing.getAccess.queryOptions(),
		enabled: config.data?.cloudBillingEnabled === true,
		refetchInterval: (query) =>
			query.state.data?.status === 'active' && query.state.data.hasAccess ? false : 60_000,
	});
	const notice = getAccessNotice(access.data);

	if (!notice) {
		return null;
	}

	return (
		<Callout
			variant={notice.restricted ? 'info' : 'warning'}
			icon={notice.restricted ? Info : Clock3}
			className='items-center rounded-none border-x-0 border-t-0 px-4 py-2 text-sm'
			role='status'
			aria-live='polite'
		>
			<div className='flex flex-wrap items-center gap-3'>
				<div className='min-w-0 flex-1'>
					<span className='font-medium text-foreground'>{notice.title}</span>{' '}
					<span className='text-muted-foreground'>{notice.description}</span>
				</div>
				{access.data?.canManageBilling ? (
					<Button size='sm' onClick={() => void openOrganizationBilling(access.data!.organizationId)}>
						Manage billing
					</Button>
				) : (
					<span className='text-xs text-muted-foreground'>Ask an organization admin to manage billing.</span>
				)}
			</div>
		</Callout>
	);
}

function getAccessNotice(
	access:
		| {
				organizationId: string;
				hasAccess: boolean;
				bypassBilling: boolean;
				status: string | null;
				trialEndsAt: Date | null;
				trialAvailable: boolean;
				canManageBilling: boolean;
				requiresBillingAction: boolean;
		  }
		| undefined,
	now = Date.now(),
) {
	if (!access) {
		return null;
	}
	if (access.bypassBilling && !access.canManageBilling) {
		return null;
	}
	if (access.trialAvailable) {
		return {
			restricted: true,
			title: 'Start your free trial when you are ready.',
			description: access.canManageBilling
				? 'Add a payment method to activate 14 days of nao Cloud.'
				: 'An organization admin can activate 14 days of nao Cloud.',
		};
	}
	if (!access.hasAccess) {
		return {
			restricted: true,
			title: 'A subscription is needed to keep using nao Cloud.',
			description: 'Your data is safe and remains available. Subscribe to run agents and make changes.',
		};
	}
	if (access.status === 'past_due') {
		return {
			restricted: false,
			title: 'A payment failed.',
			description: 'Update billing details to keep full access while Stripe retries the payment.',
		};
	}

	const remainingMs = access.trialEndsAt ? access.trialEndsAt.getTime() - now : 0;
	if (access.status !== 'trialing' || remainingMs <= 0 || remainingMs > TRIAL_WARNING_MS) {
		return null;
	}

	const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
	return {
		restricted: false,
		title: `${remainingDays} ${remainingDays === 1 ? 'day' : 'days'} left in your free trial.`,
		description: access.requiresBillingAction
			? 'Add billing details to keep full access after the trial.'
			: 'Your paid subscription will begin when the trial ends.',
	};
}
