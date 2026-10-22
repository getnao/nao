import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { Clock3, Info, X } from 'lucide-react';
import { useState } from 'react';

import type { CloudBillingAccess } from '@/lib/cloud-billing-access';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { useCloudBillingAccess } from '@/hooks/use-cloud-billing-access';
import { useOpenOrganizationBilling } from '@/hooks/use-open-organization-billing';
import { createLocalStorage } from '@/lib/local-storage';
import { trpc } from '@/main';

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_WARNING_MS = 3 * DAY_MS;
const dismissedTrialBannerStorage = createLocalStorage<string | string[]>('nao-dismissed-trial-banner', []);

export function CloudBillingAccessBanner() {
	const openOrganizationBilling = useOpenOrganizationBilling();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const [dismissedTrials, setDismissedTrials] = useState(getDismissedTrialKeys);
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const access = useCloudBillingAccess({
		enabled: config.data?.cloudBillingEnabled === true,
		pollWhileRestricted: true,
	});
	const notice = getAccessNotice(access.data);
	const trialKey =
		access.data &&
		(access.data.trialEndsAt
			? `${access.data.organizationId}:${access.data.trialEndsAt.toISOString()}`
			: access.data.trialAvailable
				? `${access.data.organizationId}:available`
				: undefined);

	if (
		!notice ||
		pathname === '/settings/organization/billing' ||
		(notice.trial && pathname.startsWith('/settings')) ||
		(notice.dismissible && trialKey && dismissedTrials.includes(trialKey))
	) {
		return null;
	}

	return (
		<Callout
			variant={notice.restricted || notice.celebratory ? 'info' : 'warning'}
			icon={notice.restricted ? Info : Clock3}
			className='items-center rounded-none border-x-0 border-t-0 px-4 py-2 text-sm'
			role='status'
			aria-live='polite'
		>
			<div className='flex min-h-8 flex-wrap items-center gap-3'>
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
				{notice.dismissible && trialKey && (
					<Button
						variant='ghost'
						size='icon-sm'
						aria-label='Dismiss trial banner'
						onClick={() => {
							const nextDismissedTrials = [...new Set([...getDismissedTrialKeys(), trialKey])];
							dismissedTrialBannerStorage.set(nextDismissedTrials);
							setDismissedTrials(nextDismissedTrials);
						}}
					>
						<X />
					</Button>
				)}
			</div>
		</Callout>
	);
}

function getDismissedTrialKeys(): string[] {
	const dismissedTrials = dismissedTrialBannerStorage.get();
	return Array.isArray(dismissedTrials) ? dismissedTrials : dismissedTrials ? [dismissedTrials] : [];
}

function getAccessNotice(access: CloudBillingAccess | undefined, now = Date.now()) {
	if (!access) {
		return null;
	}
	if (access.bypassBilling && !access.canManageBilling) {
		return null;
	}
	if (access.trialAvailable) {
		return {
			restricted: true,
			dismissible: true,
			title: 'A 14-day free trial is available.',
			description: access.canManageBilling
				? 'Start your free trial now, or it will begin when you create your first project.'
				: 'An organization admin can start the free trial.',
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
	if (access.status !== 'trialing' || remainingMs <= 0) {
		return null;
	}

	const remainingDays = Math.ceil(remainingMs / DAY_MS);
	const endingSoon = remainingMs <= TRIAL_WARNING_MS;
	if (!endingSoon && !access.canManageBilling) {
		return null;
	}

	return {
		restricted: false,
		trial: true,
		celebratory: !endingSoon,
		dismissible: !endingSoon,
		title: endingSoon ? 'Your free trial ends soon.' : 'Your free trial has started.',
		description: endingSoon
			? `${remainingDays} ${remainingDays === 1 ? 'day' : 'days'} left. ${
					access.requiresBillingAction
						? access.canManageBilling
							? 'Manage billing to keep access.'
							: 'An organization admin must manage billing to keep access.'
						: 'Your subscription will start automatically.'
				}`
			: `${remainingDays} ${remainingDays === 1 ? 'day' : 'days'} left. Only admins can see this banner.`,
	};
}
