import { IntegrationCard } from '@/components/settings/integration-card';
import { integrations, useIntegrationStatuses } from '@/components/settings/integrations';
import { usePermissions } from '@/hooks/use-permissions';

export function IntegrationsPage() {
	const integrationStatuses = useIntegrationStatuses();
	const { isAdmin } = usePermissions();

	return (
		<div className='grid gap-4 md:grid-cols-2'>
			{integrations.map((integration) => {
				const status = integrationStatuses[integration.id];

				return (
					<IntegrationCard
						key={integration.id}
						id={integration.id}
						name={integration.name}
						icon={integration.icon}
						connected={status.connected}
						summary={status.summary}
						connectUrl={isAdmin ? status.connectUrl : undefined}
					/>
				);
			})}
		</div>
	);
}
