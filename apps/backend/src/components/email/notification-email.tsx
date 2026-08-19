import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';

interface NotificationEmailProps {
	userName: string;
	title: string;
	body?: string;
	linkUrl?: string;
	ctaLabel?: string;
	unsubscribeUrl?: string;
}

export function NotificationEmail({
	userName,
	title,
	body,
	linkUrl,
	ctaLabel,
	unsubscribeUrl,
}: NotificationEmailProps) {
	return (
		<EmailLayout>
			<p>Hi {userName},</p>

			<p>
				<strong>{title}</strong>
			</p>

			{body && <p>{body}</p>}

			{linkUrl && <EmailButton href={linkUrl}>{ctaLabel ?? 'Open in nao'}</EmailButton>}

			<div className='footer'>
				<p>This is an automated message from nao.</p>
				{unsubscribeUrl && (
					<p>
						<a href={unsubscribeUrl}>Unsubscribe from these emails</a>
					</p>
				)}
			</div>
		</EmailLayout>
	);
}
