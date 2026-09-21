import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailParagraph } from './email-text';

interface ForgotPasswordProps {
	userName: string;
	resetUrl: string;
}

export function ForgotPassword({ userName, resetUrl }: ForgotPasswordProps) {
	return (
		<EmailLayout title='Reset your password on nao'>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				We received a request to reset your password on nao. Click the button below to choose a new one.
			</EmailParagraph>

			<EmailButton href={resetUrl}>Reset password</EmailButton>

			<EmailParagraph>
				This link will expire in 1 hour. If you did not request a password reset, you can safely ignore this
				email.
			</EmailParagraph>
		</EmailLayout>
	);
}
