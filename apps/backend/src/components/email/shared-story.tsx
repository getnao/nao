import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';

interface SharedStoryProps {
	userName: string;
	sharerName: string;
	storyTitle: string;
	storyUrl: string;
}

export function SharedStory({ userName, sharerName, storyTitle, storyUrl }: SharedStoryProps) {
	return (
		<EmailLayout>
			<p>Hi {userName},</p>

			<p>
				<strong>{sharerName}</strong> has shared a story with you on nao.
			</p>

			<div className='info-box'>
				<p>
					<strong>Story:</strong> {storyTitle}
				</p>
			</div>

			<EmailButton href={storyUrl}>View Story</EmailButton>

			<div className='footer'>
				<p>This is an automated message from nao.</p>
			</div>
		</EmailLayout>
	);
}
