import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		cloudflare({
			remoteBindings: true,
		}),
	],

	server: {
		allowedHosts: [".trycloudflare.com"],
	},

	resolve: {
		alias: {
			grammy: "grammy/web",
		},
	},
});
