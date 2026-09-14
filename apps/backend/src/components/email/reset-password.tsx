import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailCode, EmailParagraph } from './email-text';

interface ResetPasswordProps {
	userName: string;
	temporaryPassword: string;
	loginUrl: string;
	projectName?: string;
}

export function ResetPassword({ userName, temporaryPassword, loginUrl, projectName }: ResetPasswordProps) {
	return (
		<EmailLayout title='Your password has been reset on nao'>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				Your password on the project <strong>{projectName}</strong> has been reset on nao.
			</EmailParagraph>

			<EmailParagraph>
				Your new temporary password is <EmailCode>{temporaryPassword}</EmailCode>. You will be asked to choose a
				new password the next time you log in.
			</EmailParagraph>

			<EmailButton href={loginUrl}>Log in to nao</EmailButton>

			<EmailParagraph>
				If you did not request this password reset, please contact your project administrator immediately.
			</EmailParagraph>
		</EmailLayout>
	);
}
