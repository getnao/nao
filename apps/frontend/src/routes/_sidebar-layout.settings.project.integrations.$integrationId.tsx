import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';

import type { IntegrationId } from '@/components/settings/integrations';

import { IntegrationStatusBadge } from '@/components/settings/integration-card';
import { integrations, isIntegrationId, useIntegrationStatuses } from '@/components/settings/integrations';
import { LinkingCodesCard } from '@/components/settings/linking-code-section';
import { SlackConfigSection } from '@/components/settings/slack-config-section';
import { TeamsConfigSection } from '@/components/settings/teams-config-section';
import { TelegramConfigSection } from '@/components/settings/telegram-config-section';
import { WhatsappConfigSection } from '@/components/settings/whatsapp-config-section';
import { usePermissions } from '@/hooks/use-permissions';

export const Route = createFileRoute('/_sidebar-layout/settings/project/integrations/$integrationId')({
	beforeLoad: ({ params }) => {
		if (params.integrationId === 'nao-mcp') {
			throw redirect({
				to: '/settings/project/integrations',
				search: { tab: 'nao-mcp' },
			});
		}

		if (!isIntegrationId(params.integrationId)) {
			throw redirect({
				to: '/settings/project/integrations',
				search: { tab: 'integrations' },
			});
		}
	},
	component: IntegrationDetailPage,
});

function IntegrationDetailPage() {
	const { integrationId } = Route.useParams();
	const integrationStatuses = useIntegrationStatuses();
	const { isAdmin } = usePermissions();

	if (!isIntegrationId(integrationId)) {
		return null;
	}

	const integration = integrations.find((candidate) => candidate.id === integrationId);
	if (!integration) {
		return null;
	}

	const status = integrationStatuses[integrationId];
	const Icon = integration.icon;

	return (
		<div className='flex flex-col gap-6'>
			<Link
				to='/settings/project/integrations'
				search={{ tab: 'integrations' }}
				className='inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground'
			>
				<ChevronLeft className='size-3.5' />
				Integrations & MCP
			</Link>
			<div className='flex items-center gap-3'>
				<Icon className='size-8 shrink-0' />
				<div className='flex flex-wrap items-center gap-2'>
					<h2 className='text-lg font-semibold text-foreground'>{integration.name}</h2>
					<IntegrationStatusBadge connected={status.connected} />
				</div>
			</div>
			<IntegrationConfiguration integrationId={integrationId} isAdmin={isAdmin} />
		</div>
	);
}

function IntegrationConfiguration({ integrationId, isAdmin }: { integrationId: IntegrationId; isAdmin: boolean }) {
	if (integrationId === 'slack') {
		return <SlackConfigSection isAdmin={isAdmin} />;
	}

	if (integrationId === 'teams') {
		return <TeamsConfigSection isAdmin={isAdmin} />;
	}

	if (integrationId === 'telegram') {
		return (
			<div className='flex flex-col gap-6'>
				<TelegramConfigSection isAdmin={isAdmin} />
				<LinkingCodesCard provider='telegram' />
			</div>
		);
	}

	return (
		<div className='flex flex-col gap-6'>
			<WhatsappConfigSection isAdmin={isAdmin} />
			<LinkingCodesCard provider='whatsapp' />
		</div>
	);
}
