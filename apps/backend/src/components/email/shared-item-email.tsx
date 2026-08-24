import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';

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
		<EmailLayout>
			<p>Hi {userName},</p>

			<p>
				<strong>{sharerName}</strong> has shared a {itemLabel} with you on nao.
			</p>

			<div className='info-box'>
				<p>
					<strong>{itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1)}:</strong> {itemTitle}
				</p>
			</div>

			<EmailButton href={itemUrl}>View {itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1)}</EmailButton>

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
