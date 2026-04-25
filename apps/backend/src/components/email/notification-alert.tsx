import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';

interface NotificationAlertProps {
	userName: string;
	title: string;
	body?: string;
	actionUrl?: string;
}

export function NotificationAlert({ userName, title, body, actionUrl }: NotificationAlertProps) {
	return (
		<EmailLayout>
			<p>Hi {userName},</p>

			<div className='credentials'>
				<p>
					<strong>{title}</strong>
				</p>
				{body && <p>{body}</p>}
			</div>

			{actionUrl && <EmailButton href={actionUrl}>View Details</EmailButton>}

			<div className='footer'>
				<p>This is an automated notification from nao.</p>
				<p style={{ fontSize: '12px', color: '#9CA3AF' }}>
					You can manage your notification preferences in your nao settings.
				</p>
			</div>
		</EmailLayout>
	);
}
