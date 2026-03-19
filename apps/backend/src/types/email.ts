import { User } from 'better-auth';

interface CreatedEmail {
	subject: string;
	html: string;
}

type SendEmail =
	| { type: 'createUser'; user: User; projectName: string; temporaryPassword?: string }
	| { type: 'resetPassword'; user: User; projectName: string; temporaryPassword: string }
	| { type: 'sharedStory'; user: User; sharerName: string; storyTitle: string; storyUrl: string }
	| { type: 'sharedChat'; user: User; sharerName: string; chatTitle: string; chatUrl: string };

export { CreatedEmail, SendEmail };
