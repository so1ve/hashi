export interface User {
	blocked?: boolean;
	verified?: boolean;
}

export interface Env {
	Bindings: CloudflareBindings;
}
