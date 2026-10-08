import type { EmailBranding } from '../../utils/email-branding';
import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailCode, EmailParagraph } from './email-text';

interface ResetPasswordProps {
	userName: string;
	temporaryPassword: string;
	loginUrl: string;
	projectName?: string;
	branding: EmailBranding;
}

export function ResetPassword({ userName, temporaryPassword, loginUrl, projectName, branding }: ResetPasswordProps) {
	return (
		<EmailLayout title={`Your password has been reset on ${branding.appName}`} branding={branding}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				Your password on the project <strong>{projectName}</strong> has been reset on {branding.appName}.
			</EmailParagraph>

			<EmailParagraph>
				Your new temporary password is <EmailCode>{temporaryPassword}</EmailCode>. You will be asked to choose a
				new password the next time you log in.
			</EmailParagraph>

			<EmailButton href={loginUrl} color={branding.brandColor}>
				Log in to {branding.appName}
			</EmailButton>

			<EmailParagraph>
				If you did not request this password reset, please contact your project administrator immediately.
			</EmailParagraph>
		</EmailLayout>
	);
}
