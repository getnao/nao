import type { EmailBranding } from '../../utils/email-branding';
import { EmailButton } from './email-button';
import { EmailLayout } from './email-layout';
import { EmailParagraph } from './email-text';

interface AccountExistsProps {
	userName: string;
	loginUrl: string;
	branding: EmailBranding;
}

export function AccountExists({ userName, loginUrl, branding }: AccountExistsProps) {
	return (
		<EmailLayout title={`You already have a ${branding.appName} account`} branding={branding}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				Someone tried to sign up to {branding.appName} with this email address, but you already have an account.
			</EmailParagraph>

			<EmailButton href={loginUrl} color={branding.brandColor}>
				Log in
			</EmailButton>

			<EmailParagraph>
				Forgot your password? You can reset it from the login page. If this was not you, you can safely ignore
				this email.
			</EmailParagraph>
		</EmailLayout>
	);
}
