import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailParagraph } from './email-text';

interface SharedItemEmailProps {
	userName: string;
	sharerName: string;
	itemLabel: string;
	itemTitle: string;
	itemUrl: string;
}

export function SharedItemEmail({ userName, sharerName, itemLabel, itemTitle, itemUrl }: SharedItemEmailProps) {
	return (
		<EmailLayout title={`${sharerName} shared "${itemTitle}" with you on nao`}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				<strong>{sharerName}</strong> shared the {itemLabel} <strong>{itemTitle}</strong> with you on nao.
			</EmailParagraph>

			<EmailButton href={itemUrl}>View {itemLabel}</EmailButton>
		</EmailLayout>
	);
}
