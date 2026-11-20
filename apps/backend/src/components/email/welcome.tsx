import type { EmailBranding } from '../../utils/email-branding';
import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailParagraph } from './email-text';

interface WelcomeProps {
	userName: string;
	appUrl: string;
	docsUrl: string;
	slackUrl: string;
	branding: EmailBranding;
}

export function Welcome({ userName, appUrl, docsUrl, slackUrl, branding }: WelcomeProps) {
	return (
		<EmailLayout title={`Welcome to ${branding.appName} Cloud`} branding={branding}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				Welcome to {branding.appName} Cloud. Your account is ready, and you can start building your analytics
				agent.
			</EmailParagraph>

			<EmailButton href={appUrl} color={branding.brandColor}>
				Open {branding.appName}
			</EmailButton>

			<EmailParagraph>
				Explore the{' '}
				<a href={docsUrl} style={{ color: branding.brandColor }}>
					documentation
				</a>{' '}
				or join the{' '}
				<a href={slackUrl} style={{ color: branding.brandColor }}>
					nao Slack community
				</a>{' '}
				if you need help getting started.
			</EmailParagraph>
		</EmailLayout>
	);
}
