import { $Fetch, ofetch } from "ofetch";

export class Api {
	private fetch: $Fetch;

	constructor(token: string) {
		this.fetch = ofetch.create({
			baseURL: `https://api.telegram.org/bot${token}`,
		});
	}

	async setWebhook(url: string) {
		return await this.fetch("/setWebhook", {
			method: "POST",
			body: { url },
		});
	}
}
