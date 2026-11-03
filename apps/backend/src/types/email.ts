export interface EmailAttachment {
	filename: string;
	content: Buffer | string;
	contentType?: string;
	cid?: string;
}

export const CLOUD_WELCOME_EMAIL_JOB_NAME = 'email.cloud.welcome';

export type CloudWelcomeEmailJobPayload = { kind: 'user'; userId: string } | { kind: 'trial'; organizationId: string };

interface CreatedEmail {
	subject: string;
	html: string;
	replyTo?: string;
	attachments?: EmailAttachment[];
}

export { CreatedEmail };
