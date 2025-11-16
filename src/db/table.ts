import type {
	Marker,
	SettingsKey,
	SqliteBoolean,
	Table,
	TextsKey,
} from "../types";

export const expectedTables = {
	users: {
		chatId: "TEXT PRIMARY KEY" as Marker<number>,
		blocked: "BOOLEAN DEFAULT FALSE" as Marker<SqliteBoolean>,
		verified: "BOOLEAN DEFAULT FALSE" as Marker<SqliteBoolean>,
		verificationMessageId: "INTEGER" as Marker<number | null>,
	},
	chatTopicMappings: {
		chatId: "INTEGER PRIMARY KEY" as Marker<number>,
		topicId: "INTEGER NOT NULL" as Marker<number>,
	},
	settings: {
		key: "TEXT PRIMARY KEY" as Marker<SettingsKey>,
		value: "BOOLEAN DEFAULT TRUE" as Marker<SqliteBoolean>,
	},
	texts: {
		key: "TEXT PRIMARY KEY" as Marker<TextsKey>,
		value: "TEXT" as Marker<string>,
	},
} satisfies Table;
