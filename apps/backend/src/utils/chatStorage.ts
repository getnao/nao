import fs from 'fs';
import path from 'path';

import type { Chat } from '../types/chat';
import type { Message } from '../types/chat';

const chatsDirectory = path.join(process.cwd(), 'chats');

/** Temporary file based storage for chats */
export const chatStorage = {
	async getChat(chatId: string): Promise<Chat | undefined> {
		const filePath = path.join(chatsDirectory, `${chatId}.json`);
		if (!fs.existsSync(filePath)) {
			return undefined;
		}
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	},

	async createChat({ title = 'New Chat', messages = [] }: { title?: string; messages?: Message[] }): Promise<Chat> {
		const chatId = crypto.randomUUID();
		const filePath = path.join(chatsDirectory, `${chatId}.json`);
		const chat: Chat = {
			id: chatId,
			title,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages,
		};
		if (!fs.existsSync(chatsDirectory)) {
			fs.mkdirSync(chatsDirectory, { recursive: true });
		}
		fs.writeFileSync(filePath, JSON.stringify(chat, null, 2));
		return chat;
	},

	async addMessages(chatId: string, messages: Message[]): Promise<Chat> {
		const chat = await this.getChat(chatId);
		if (!chat) {
			throw new Error(`Chat with id ${chatId} not found.`);
		}
		chat.messages.push(...messages);
		fs.writeFileSync(path.join(chatsDirectory, `${chatId}.json`), JSON.stringify(chat, null, 2));
		return chat;
	},

	async listChats(): Promise<Omit<Chat, 'messages'>[]> {
		if (!fs.existsSync(chatsDirectory)) {
			return [];
		}
		const files = fs.readdirSync(chatsDirectory).filter((file) => file.endsWith('.json'));
		const chats = files.map((file) => {
			const filePath = path.join(chatsDirectory, file);
			const { messages, ...chat } = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Chat;
			return chat;
		});
		return chats.sort((a, b) => b.createdAt - a.createdAt);
	},

	async deleteChat(chatId: string): Promise<boolean> {
		const filePath = path.join(chatsDirectory, `${chatId}.json`);
		if (!fs.existsSync(filePath)) {
			return false;
		}
		fs.unlinkSync(filePath);
		return true;
	},
};
