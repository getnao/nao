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
}

export function SharedItemEmail({
	userName,
	sharerName,
	itemLabel,
	itemTitle,
	itemUrl,
	unsubscribeUrl,
}: SharedItemEmailProps) {
	return (
		<EmailLayout title={`${sharerName} shared "${itemTitle}" with you on nao`}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				<strong>{sharerName}</strong> shared the {itemLabel} <strong>{itemTitle}</strong> with you on nao.
			</EmailParagraph>

			<EmailButton href={itemUrl}>View {itemLabel}</EmailButton>

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
