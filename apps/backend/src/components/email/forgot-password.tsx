import type { EmailBranding } from '../../utils/email-branding';
import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailParagraph } from './email-text';

interface ForgotPasswordProps {
	userName: string;
	resetUrl: string;
	branding: EmailBranding;
}

export function ForgotPassword({ userName, resetUrl, branding }: ForgotPasswordProps) {
	return (
		<EmailLayout title={`Reset your password on ${branding.appName}`} branding={branding}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				We received a request to reset your password on {branding.appName}. Click the button below to choose a
				new one.
			</EmailParagraph>

			<EmailButton href={resetUrl} color={branding.brandColor}>
				Reset password
			</EmailButton>

			<EmailParagraph>
				This link will expire in 1 hour. If you did not request a password reset, you can safely ignore this
				email.
			</EmailParagraph>
		</EmailLayout>
	);
}
