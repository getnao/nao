import type { EmailBranding } from '../../utils/email-branding';
import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailParagraph } from './email-text';

interface VerifyEmailProps {
	userName: string;
	verificationUrl: string;
	branding: EmailBranding;
}

export function VerifyEmail({ userName, verificationUrl, branding }: VerifyEmailProps) {
	return (
		<EmailLayout title={`Verify your email on ${branding.appName}`} branding={branding}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				Verify your email address to finish creating your {branding.appName} account.
			</EmailParagraph>

			<EmailButton href={verificationUrl} color={branding.brandColor}>
				Verify email
			</EmailButton>

			<EmailParagraph>
				This link will expire in 1 hour. If you did not create this account, you can safely ignore this email.
			</EmailParagraph>
		</EmailLayout>
	);
}
