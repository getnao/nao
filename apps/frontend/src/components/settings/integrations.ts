import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { ComponentType } from 'react';

import type { TrpcRouter } from '@nao/backend/trpc';
import MattermostIcon from '@/components/icons/mattermost.svg';
import TeamsIcon from '@/components/icons/microsoft-teams.svg';
import SlackIcon from '@/components/icons/slack.svg';
import TelegramIcon from '@/components/icons/telegram.svg';
import WhatsAppIcon from '@/components/icons/whatsapp.svg';
import { trpc } from '@/main';

export const integrationIds = ['slack', 'teams', 'telegram', 'whatsapp', 'mattermost'] as const;

export type IntegrationId = (typeof integrationIds)[number];

interface IntegrationMetadata {
	id: IntegrationId;
	name: string;
	icon: ComponentType<{ className?: string }>;
}

interface IntegrationStatus {
	connected: boolean;
	summary: string;
}

type SlackProjectConfig = NonNullable<inferRouterOutputs<TrpcRouter>['project']['getSlackConfig']['projectConfig']>;

export const integrations: IntegrationMetadata[] = [
	{
		id: 'slack',
		name: 'Slack',
		icon: SlackIcon,
	},
	{
		id: 'teams',
		name: 'Microsoft Teams',
		icon: TeamsIcon,
	},
	{
		id: 'telegram',
		name: 'Telegram',
		icon: TelegramIcon,
	},
	{
		id: 'whatsapp',
		name: 'WhatsApp',
		icon: WhatsAppIcon,
	},
	{
		id: 'mattermost',
		name: 'Mattermost',
		icon: MattermostIcon,
	},
];

export function useIntegrationStatuses(): Record<IntegrationId, IntegrationStatus> {
	const slackConfig = useQuery(trpc.project.getSlackConfig.queryOptions());
	const teamsConfig = useQuery(trpc.project.getTeamsConfig.queryOptions());
	const telegramConfig = useQuery(trpc.project.getTelegramConfig.queryOptions());
	const whatsappConfig = useQuery(trpc.project.getWhatsappConfig.queryOptions());
	const whatsappLinks = useQuery(trpc.project.getCurrentUserWhatsappLinks.queryOptions());
	const mattermostConfig = useQuery(trpc.project.getMattermostConfig.queryOptions());

	const slackProjectConfig = slackConfig.data?.projectConfig;
	const teamsProjectConfig = teamsConfig.data?.projectConfig;
	const telegramProjectConfig = telegramConfig.data?.projectConfig;
	const whatsappProjectConfig = whatsappConfig.data?.projectConfig;
	const mattermostProjectConfig = mattermostConfig.data?.projectConfig;

	return {
		slack: {
			connected: Boolean(slackProjectConfig),
			summary: slackProjectConfig
				? getSlackSummary(slackProjectConfig.transportMode, slackProjectConfig.replyMode)
				: 'Chat with nao from Slack',
		},
		teams: {
			connected: Boolean(teamsProjectConfig),
			summary: 'Chat with nao from Microsoft Teams',
		},
		telegram: {
			connected: Boolean(telegramProjectConfig),
			summary: telegramProjectConfig ? 'Bot connected · link with a sign-in code' : 'Chat with nao from Telegram',
		},
		whatsapp: {
			connected: Boolean(whatsappProjectConfig),
			summary: whatsappProjectConfig
				? getWhatsappSummary(whatsappLinks.data?.length ?? 0)
				: 'Chat with nao from WhatsApp',
		},
		mattermost: {
			connected: mattermostConfig.data?.connected === true,
			summary:
				mattermostConfig.data?.connected === true
					? 'Bot connected'
					: mattermostProjectConfig
						? 'Saved configuration is not connected'
						: 'Chat with nao from Mattermost',
		},
	};
}

export function isIntegrationId(value: unknown): value is IntegrationId {
	return typeof value === 'string' && integrationIds.some((integrationId) => integrationId === value);
}

function getSlackSummary(
	transportMode: SlackProjectConfig['transportMode'],
	replyMode: SlackProjectConfig['replyMode'],
) {
	const transport = transportMode === 'socket' ? 'Socket Mode' : 'Webhook';
	const replies = replyMode === 'mention' ? 'replies when mentioned' : 'replies in active threads';
	return `${transport} · ${replies}`;
}

function getWhatsappSummary(linkedAccountCount: number) {
	if (linkedAccountCount === 0) {
		return 'App connected · no linked accounts';
	}

	return `${linkedAccountCount} linked ${linkedAccountCount === 1 ? 'account' : 'accounts'}`;
}
