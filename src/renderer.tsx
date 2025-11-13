import { jsxRenderer } from "hono/jsx-renderer";

export const renderer = jsxRenderer(({ children }) => (
	<html>
		<head>
			<link href="/static/style.css" rel="stylesheet" />
		</head>
		<body>{children}</body>
	</html>
));
