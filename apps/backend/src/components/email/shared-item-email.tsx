import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailParagraph } from './email-text';

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
