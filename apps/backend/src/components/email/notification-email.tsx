import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';

interface NotificationEmailProps {
	userName: string;
	title: string;
	body?: string;
	bodyHtml?: string;
	linkUrl?: string;
	ctaLabel?: string;
	unsubscribeUrl?: string;
}

export function NotificationEmail({
	userName,
	title,
	body,
	bodyHtml,
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

			{bodyHtml && (
				<div
					style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid #e5e7eb' }}
					dangerouslySetInnerHTML={{ __html: bodyHtml }}
				/>
			)}
		</EmailLayout>
	);
}
