import { Link, Script, ViteClient } from "vite-ssr-components/hono";

export const VerifyPage = () => (
	<html>
		<head>
			<ViteClient />
			<Script src="/src/pages/client.tsx" />
			<Link href="/src/pages/style.css" rel="stylesheet" />
		</head>
		<body>
			<div id="root" />
		</body>
	</html>
);
