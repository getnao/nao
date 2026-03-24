import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';

interface ForgotPasswordProps {
	userName: string;
	resetUrl: string;
}

export function ForgotPassword({ userName, resetUrl }: ForgotPasswordProps) {
	return (
		<EmailLayout>
			<p>Hi {userName},</p>

			<p>We received a request to reset your password on nao. Click the button below to choose a new password.</p>

			<EmailButton href={resetUrl}>Reset your password</EmailButton>

			<p>
				This link will expire in 1 hour. If you did not request a password reset, you can safely ignore this
				email.
			</p>

			<div className='footer'>
				<p>This is an automated message from nao.</p>
			</div>
		</EmailLayout>
	);
}
