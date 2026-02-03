import { EmailData } from '../../types/email';
import { EmailButton } from './emailButton';
import { EmailLayout } from './emailLayout';
import { WarningBox } from './warningBox';

export function UserAddedToProjectEmail({ userName, projectName, loginUrl, to, temporaryPassword }: EmailData) {
	const isNewUser = !!temporaryPassword;

	return (
		<EmailLayout>
			<p>Hi {userName},</p>

			<p>
				{isNewUser ? (
					<>
						You've been invited to join the project <strong>{projectName}</strong> on nao.
					</>
				) : (
					"You've been added to a new project on nao."
				)}
			</p>

			{isNewUser ? (
				<>
					<div className='credentials'>
						<p>
							<strong>Your login credentials:</strong>
						</p>
						<p>
							Email: <strong>{to || ''}</strong>
						</p>
						<p>
							Temporary Password: <span className='password'>{temporaryPassword}</span>
						</p>
					</div>

					<WarningBox>
						You will be required to change this password on your first login for security reasons.
					</WarningBox>
				</>
			) : (
				<div className='info-box'>
					<p>
						<strong>Project:</strong> {projectName}
					</p>
					<p>You can now access this project using your existing nao account.</p>
				</div>
			)}

			<EmailButton href={loginUrl}>Login to nao</EmailButton>

			<p>
				If you have any questions{isNewUser ? '' : ' about this project'}, please contact your project
				administrator.
			</p>

			<div className='footer'>
				<p>This is an automated message from nao.</p>
			</div>
		</EmailLayout>
	);
}
