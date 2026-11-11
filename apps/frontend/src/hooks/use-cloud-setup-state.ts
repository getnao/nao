import { useQuery } from '@tanstack/react-query';

import { shouldReturnToOnboarding } from '@/components/onboarding-progress';
import { useCloudBillingAccess } from '@/hooks/use-cloud-billing-access';
import { trpc } from '@/main';

export function useCloudSetupState() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const hasProject = project.data != null;
	const cloudBillingEnabled = config.data?.cloudBillingEnabled === true;
	const projectSetup = useQuery({
		...trpc.project.isCurrentSetupComplete.queryOptions(),
		enabled: hasProject,
	});
	const billingAccess = useCloudBillingAccess({
		enabled: cloudBillingEnabled && hasProject,
	});
	const setupComplete = projectSetup.data;
	const accessPending = cloudBillingEnabled && hasProject && billingAccess.isPending;

	return {
		limbo: shouldReturnToOnboarding({
			cloudBillingEnabled,
			hasProject,
			setupComplete,
			hasAccess: billingAccess.data?.hasAccess,
		}),
		resolving: hasProject && cloudBillingEnabled && (projectSetup.isPending || accessPending),
	};
}
