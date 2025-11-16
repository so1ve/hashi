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
	}, 1000);
}

const style = `
* {
	margin: 0;
	padding: 0;
	box-sizing: border-box;
}

html,
body {
	height: 100%;
	width: 100%;
}

body {
	display: flex;
	justify-content: center;
	align-items: center;
	background-color: #f5f5f5;
}

.cf-turnstile {
	display: flex;
	justify-content: center;
	align-items: center;
}
`;

export const VerifyPage = ({ siteKey: siteId }: Props) => (
	<html>
		<head>
			<link rel="preconnect" href="https://challenges.cloudflare.com" />
			<style>{style}</style>
			<script
				src="https://challenges.cloudflare.com/turnstile/v0/api.js"
				async
				defer
			/>
			<script src="https://telegram.org/js/telegram-web-app.js" />
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
