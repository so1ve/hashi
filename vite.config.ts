import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import ssrPlugin from "vite-ssr-components/plugin";

export default defineConfig({
	plugins: [cloudflare(), ssrPlugin()],

	server: {
		allowedHosts: [".trycloudflare.com"],
	},

	resolve: {
		alias: {
			grammy: "grammy/web",
		},
	},
});
