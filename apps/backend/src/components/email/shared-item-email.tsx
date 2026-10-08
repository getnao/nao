import type { EmailBranding } from '../../utils/email-branding';
import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailParagraph } from './email-text';
import { emailColors } from './email-theme';

interface SharedItemEmailProps {
	userName: string;
	sharerName: string;
	itemLabel: string;
	itemTitle: string;
	itemUrl: string;
	unsubscribeUrl?: string;
	branding: EmailBranding;
}

export function SharedItemEmail({
	userName,
	sharerName,
	itemLabel,
	itemTitle,
	itemUrl,
	unsubscribeUrl,
	branding,
}: SharedItemEmailProps) {
	return (
		<EmailLayout title={`${sharerName} shared "${itemTitle}" with you on ${branding.appName}`} branding={branding}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				<strong>{sharerName}</strong> shared the {itemLabel} <strong>{itemTitle}</strong> with you on{' '}
				{branding.appName}.
			</EmailParagraph>

			<EmailButton href={itemUrl} color={branding.brandColor}>
				View {itemLabel}
			</EmailButton>

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
