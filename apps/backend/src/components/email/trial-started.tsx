import type { EmailBranding } from '../../utils/email-branding';
import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailParagraph } from './email-text';

interface TrialStartedProps {
	userName: string;
	appUrl: string;
	docsUrl: string;
	slackUrl: string;
	creditAmount: string;
	trialDays: number;
	trialEndDate: string;
	branding: EmailBranding;
}

export function TrialStarted({
	userName,
	appUrl,
	docsUrl,
	slackUrl,
	creditAmount,
	trialDays,
	trialEndDate,
	branding,
}: TrialStartedProps) {
	return (
		<EmailLayout title={`Your ${branding.appName} Cloud trial and credits are ready`} branding={branding}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				Your {trialDays}-day {branding.appName} Cloud trial is now active through{' '}
				<strong>{trialEndDate}</strong>. We've also added <strong>{creditAmount}</strong> of credits to your
				organization.
			</EmailParagraph>

			<EmailParagraph>
				Credits pay for your team's nao-managed AI usage. Your trial controls access to {branding.appName}{' '}
				Cloud, so choose a paid plan before it ends to keep using the service without interruption.
			</EmailParagraph>

			<EmailParagraph>
				Each new user who verifies their email and joins a configured project adds another <strong>$5</strong>{' '}
				to your organization's shared credit pool.
			</EmailParagraph>

			<EmailButton href={appUrl} color={branding.brandColor}>
				Start using {branding.appName}
			</EmailButton>

			<EmailParagraph>
				Learn more in the{' '}
				<a href={docsUrl} style={{ color: branding.brandColor }}>
					documentation
				</a>{' '}
				or ask questions in the{' '}
				<a href={slackUrl} style={{ color: branding.brandColor }}>
					nao Slack community
				</a>
				.
			</EmailParagraph>
		</EmailLayout>
	);
}
