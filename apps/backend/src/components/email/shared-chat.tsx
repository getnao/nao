import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';

interface SharedChatProps {
	userName: string;
	sharerName: string;
	chatTitle: string;
	chatUrl: string;
}

export function SharedChat({ userName, sharerName, chatTitle, chatUrl }: SharedChatProps) {
	return (
		<EmailLayout>
			<p>Hi {userName},</p>

			<p>
				<strong>{sharerName}</strong> has shared a chat with you on nao.
			</p>

			<div className='info-box'>
				<p>
					<strong>Chat:</strong> {chatTitle}
				</p>
			</div>

			<EmailButton href={chatUrl}>View Chat</EmailButton>

			<div className='footer'>
				<p>This is an automated message from nao.</p>
			</div>
		</EmailLayout>
	);
}
