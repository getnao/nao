import { User } from 'better-auth';

interface CreatedEmail {
	subject: string;
	html: string;
}

type SendEmail =
	| { type: 'createUser'; user: User; projectName: string; temporaryPassword?: string }
	| { type: 'resetPassword'; user: User; projectName: string; temporaryPassword: string }
	| { type: 'sharedStory'; user: User; sharerName: string; storyTitle: string; storyUrl: string };

export { CreatedEmail, SendEmail };
