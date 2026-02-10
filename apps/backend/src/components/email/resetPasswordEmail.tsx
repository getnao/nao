import { EmailData } from '../../types/email';
import { EmailButton } from './emailButton';
import { EmailLayout } from './emailLayout';
import { WarningBox } from './warningBox';

export function ResetPasswordEmail({ userName, temporaryPassword, loginUrl, projectName }: EmailData) {
	return (
		<EmailLayout>
			<p>Hi {userName},</p>

			<p>
				Your password on the project <strong>{projectName}</strong> has been reset on nao.
			</p>

			<div className='credentials'>
				<p>
					<strong>Your new temporary password:</strong>
				</p>
				<p className='password'>{temporaryPassword}</p>
			</div>

			<WarningBox>
				You will be required to change this password on your next login for security reasons.
			</WarningBox>

			<EmailButton href={loginUrl}>Login to nao</EmailButton>

			<p>If you did not request this password reset, please contact your project administrator immediately.</p>

			<div className='footer'>
				<p>This is an automated message from nao.</p>
			</div>
		</EmailLayout>
	);
}
