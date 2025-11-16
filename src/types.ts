export interface User {
	chatId: number;
	blocked: SqliteBoolean;
	verified: SqliteBoolean;
	verificationMessageId: number | null;
}

export type Settings = Record<string, SqliteBoolean>;
export type Texts = Record<string, string>;

export interface Env {
	Bindings: CloudflareBindings;
}

export type SqliteBoolean = 0 | 1;
export type Marker<T> = string & { __marker?: T };
export type TableStructure = Record<string, string>;
export type Table = Record<string, TableStructure>;
export type ExtractType<T> = T extends Marker<infer U> ? U : never;
export type ExtractTypeObject<T> = {
	[P in keyof T]: T[P] extends Marker<infer U> ? U : T[P];
};
export type MaybeArray<T> = T | T[];
