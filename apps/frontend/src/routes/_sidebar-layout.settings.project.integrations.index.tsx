import { createFileRoute, redirect } from '@tanstack/react-router';

import type { IntegrationId } from '@/components/settings/integrations';
import { isIntegrationId } from '@/components/settings/integrations';
import { IntegrationsPage } from '@/components/settings/integrations-page';

export const Route = createFileRoute('/_sidebar-layout/settings/project/integrations/')({
	staticData: {
		title: 'Integrations',
		description: 'Connect nao to chat tools and AI clients',
	},
	validateSearch: (search: Record<string, unknown>): { integration?: IntegrationId } => ({
		integration: isIntegrationId(search.integration) ? search.integration : undefined,
	}),
	beforeLoad: ({ search }) => {
		if (search.integration) {
			throw redirect({
				to: '/settings/project/integrations/$integrationId',
				params: { integrationId: search.integration },
			});
		}
	},
	component: ProjectIntegrationsPage,
});

function ProjectIntegrationsPage() {
	return <IntegrationsPage />;
}
