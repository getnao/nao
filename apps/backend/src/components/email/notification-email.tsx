import type { EmailBranding } from '../../utils/email-branding';
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
	branding: EmailBranding;
}

export function NotificationEmail({
	userName,
	title,
	body,
	bodyHtml,
	linkUrl,
	ctaLabel,
	unsubscribeUrl,
	branding,
}: NotificationEmailProps) {
	return (
		<EmailLayout title={`${title} — ${branding.appName}`} branding={branding}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				<strong>{title}</strong>
			</EmailParagraph>

			{body && <EmailParagraph>{body}</EmailParagraph>}

			{linkUrl && (
				<EmailButton href={linkUrl} color={branding.brandColor}>
					{ctaLabel ?? `Open in ${branding.appName}`}
				</EmailButton>
			)}

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
