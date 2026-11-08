import type { EmailBranding } from '../../utils/email-branding';
import { EmailLayout } from './email-layout';
import { EmailCode, EmailParagraph } from './email-text';

interface TwoFactorCodeProps {
	userName: string;
	code: string;
	expiresInMinutes: number;
	branding: EmailBranding;
}

export function TwoFactorCode({ userName, code, expiresInMinutes, branding }: TwoFactorCodeProps) {
	return (
		<EmailLayout title={`Your ${branding.appName} verification code`} branding={branding}>
			<EmailParagraph>Hi {userName},</EmailParagraph>

			<EmailParagraph>
				Your verification code is <EmailCode>{code}</EmailCode>. It expires in {expiresInMinutes} minutes.
			</EmailParagraph>

			<EmailParagraph>
				If you did not request this code, someone may know your {branding.appName} password. Change it as soon
				as possible.
			</EmailParagraph>
		</EmailLayout>
	);
}
