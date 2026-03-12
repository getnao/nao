import { User } from 'better-auth';

interface CreatedEmail {
	subject: string;
	html: string;
}

interface SendEmail {
	user: User;
	type: 'createUser' | 'resetPassword' | 'sharedStory';
	projectName?: string;
	temporaryPassword?: string;
	sharerName?: string;
	storyTitle?: string;
	storyUrl?: string;
}

export { CreatedEmail, SendEmail };
