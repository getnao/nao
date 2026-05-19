export interface EmailAttachment {
	filename: string;
	content: Buffer | string;
	contentType?: string;
	cid?: string;
}

interface CreatedEmail {
	subject: string;
	html: string;
	attachments?: EmailAttachment[];
}

export { CreatedEmail };
