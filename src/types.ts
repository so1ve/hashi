export interface User {
	blocked?: boolean;
	verified?: boolean;
	verificationMessageId?: number;
}

export interface Env {
	Bindings: CloudflareBindings;
}
