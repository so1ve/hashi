export interface User {
	blocked?: boolean;
	verified?: boolean;
	verificationMessageId?: number;
}

export interface Settings {
	messageSentNotification: boolean;
	text: {
		welcome: string;
		messageSent: string;
	};
}

export interface Env {
	Bindings: CloudflareBindings;
}

export type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends Record<PropertyKey, unknown>
		? DeepPartial<T[P]>
		: T[P];
};
