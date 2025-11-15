import { Link, Script, ViteClient } from "vite-ssr-components/hono";

interface Props {
	siteKey: string;
}

declare global {
	interface Window {
		Telegram: any;
	}
}

// Client only.
async function onTurnstileSuccess(token: string) {
	const params = new URLSearchParams(location.search);
	const chatId = params.get("chatId");

	await fetch("/verify/callback", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			token,
			chatId,
		}),
	});

	setTimeout(() => {
		window.Telegram.WebApp.close();
	}, 2500);
}

export const VerifyPage = ({ siteKey: siteId }: Props) => (
	<html>
		<head>
			<ViteClient />
			<Link rel="preconnect" href="https://challenges.cloudflare.com" />
			<Link href="/src/verify/style.css" rel="stylesheet" />
			<Script
				src="https://challenges.cloudflare.com/turnstile/v0/api.js"
				async
				defer
			/>
			<Script src="https://telegram.org/js/telegram-web-app.js"></Script>
		</head>
		<body>
			<div
				class="cf-turnstile"
				data-callback="onTurnstileSuccess"
				data-sitekey={siteId}
			/>
			<script
				dangerouslySetInnerHTML={{
					__html: onTurnstileSuccess.toString(),
				}}
			/>
		</body>
	</html>
);
