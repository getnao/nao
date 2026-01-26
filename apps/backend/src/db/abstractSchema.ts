import dbConfig, { Dialect } from './dbConfig';
import * as pgSchema from './pgSchema';
import * as sqliteSchema from './sqliteSchema';

const allSchema = dbConfig.dialect === Dialect.Postgres ? pgSchema : sqliteSchema;

export type NewUser = typeof sqliteSchema.user.$inferInsert;
export type User = typeof sqliteSchema.user.$inferSelect;

export type NewAccount = typeof sqliteSchema.account.$inferInsert;
export type Account = typeof sqliteSchema.account.$inferSelect;

export type NewChat = typeof sqliteSchema.chat.$inferInsert;
export type DBChat = typeof sqliteSchema.chat.$inferSelect;

export type DBChatMessage = typeof sqliteSchema.chatMessage.$inferSelect;
export type NewChatMessage = typeof sqliteSchema.chatMessage.$inferInsert;

export type DBMessagePart = typeof sqliteSchema.messagePart.$inferSelect;
export type NewMessagePart = typeof sqliteSchema.messagePart.$inferInsert;

export type MessageFeedback = typeof sqliteSchema.messageFeedback.$inferSelect;
export type NewMessageFeedback = typeof sqliteSchema.messageFeedback.$inferInsert;

export type DBProject = typeof sqliteSchema.project.$inferSelect;
export type NewProject = typeof sqliteSchema.project.$inferInsert;

export type DBProjectMember = typeof sqliteSchema.projectMember.$inferSelect;
export type NewProjectMember = typeof sqliteSchema.projectMember.$inferInsert;

export type DBProjectLlmConfig = typeof sqliteSchema.projectLlmConfig.$inferSelect;
export type NewProjectLlmConfig = typeof sqliteSchema.projectLlmConfig.$inferInsert;

export default allSchema as typeof sqliteSchema;
