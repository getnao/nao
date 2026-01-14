import dbConfig, { Dialect } from './dbConfig';
import * as pgSchema from './pgSchema';
import * as sqliteSchema from './sqliteSchema';

const allSchema = dbConfig.dialect === Dialect.Postgres ? pgSchema : sqliteSchema;

export type NewUser = typeof sqliteSchema.user.$inferInsert;
export type User = typeof sqliteSchema.user.$inferSelect;

export type NewChat = typeof sqliteSchema.chat.$inferInsert;
export type DBChat = typeof sqliteSchema.chat.$inferSelect;

export type DBChatMessage = typeof sqliteSchema.chatMessage.$inferSelect;
export type NewChatMessage = typeof sqliteSchema.chatMessage.$inferInsert;

export type DBMessagePart = typeof sqliteSchema.messagePart.$inferSelect;
export type NewMessagePart = typeof sqliteSchema.messagePart.$inferInsert;

export default allSchema as typeof sqliteSchema;
