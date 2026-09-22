import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailParagraph } from './email-text';
import { emailColors } from './email-theme';

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
		<EmailLayout title={`${title} — nao`}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				<strong>{title}</strong>
			</EmailParagraph>

			{body && <EmailParagraph>{body}</EmailParagraph>}

			{linkUrl && <EmailButton href={linkUrl}>{ctaLabel ?? 'Open in nao'}</EmailButton>}

			{bodyHtml && (
				<div
					style={{ margin: '8px 0 24px', paddingTop: 24, borderTop: '1px solid #e5e7eb' }}
					dangerouslySetInnerHTML={{ __html: bodyHtml }}
				/>
			)}

			{unsubscribeUrl && (
				<EmailParagraph muted>
					<a href={unsubscribeUrl} style={{ color: emailColors.muted }}>
						Unsubscribe from these emails
					</a>
				</EmailParagraph>
			)}
		</EmailLayout>
	);
}
