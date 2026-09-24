import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailParagraph } from './email-text';

interface CloudTrialEndingProps {
	userName: string;
	organizationName: string;
	trialEndsAt: Date;
	billingUrl: string;
}

export function CloudTrialEnding({ userName, organizationName, trialEndsAt, billingUrl }: CloudTrialEndingProps) {
	const endDate = trialEndsAt.toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC',
	});
	return (
		<EmailLayout title={`Your nao Cloud trial ends ${endDate}`}>
			<EmailParagraph>Hi {userName},</EmailParagraph>
			<EmailParagraph>
				The nao Cloud trial for <strong>{organizationName}</strong> ends on <strong>{endDate}</strong>. Add a
				payment method before then to continue using paid capabilities without interruption.
			</EmailParagraph>
			<EmailButton href={billingUrl}>Manage billing</EmailButton>
		</EmailLayout>
	);
}
