import path from 'node:path';
import process from 'node:process';

import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

/* global console */

dotenv.config({
	path: path.join(process.cwd(), '..', '..', '.env'),
});

const { SMTP_HOST, SMTP_PORT, SMTP_SSL, SMTP_MAIL_FROM, SMTP_PASSWORD } = process.env;

const to = process.argv[2] || SMTP_MAIL_FROM;

const missingVars = [
	['SMTP_HOST', SMTP_HOST],
	['SMTP_MAIL_FROM', SMTP_MAIL_FROM],
	['SMTP_PASSWORD', SMTP_PASSWORD],
].filter(([, value]) => !value);

if (missingVars.length > 0) {
	console.error(`Missing required env vars: ${missingVars.map(([name]) => name).join(', ')}`);
	process.exit(1);
}

if (!to) {
	console.error('No recipient provided and SMTP_MAIL_FROM is not set.');
	process.exit(1);
}

const transporter = nodemailer.createTransport({
	host: SMTP_HOST,
	port: Number(SMTP_PORT) || 587,
	secure: SMTP_SSL === 'true',
	auth: {
		user: SMTP_MAIL_FROM,
		pass: SMTP_PASSWORD,
	},
});

console.log(`Sending test email to ${to} using ${SMTP_HOST}:${Number(SMTP_PORT) || 587}`);

const info = await transporter.sendMail({
	from: SMTP_MAIL_FROM,
	to,
	subject: 'Test from node script',
	html: '<p>Hello from a direct Node script.</p>',
});

console.log('Email sent successfully');
console.log(`messageId: ${info.messageId}`);
console.log(info);
