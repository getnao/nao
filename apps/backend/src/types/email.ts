import { User } from 'better-auth';

interface CreatedEmailData {
	subject: string;
	html: string;
	text: string;
}

interface SendEmailParams {
	user: User;
	type: 'createUser' | 'resetPassword';
	projectName?: string;
	temporaryPassword?: string;
}

interface EmailData {
	to?: string;
	userName: string;
	projectName?: string;
	temporaryPassword?: string;
	loginUrl: string;
}

export { CreatedEmailData, EmailData, SendEmailParams };
