import { createMiddleware } from "hono/factory";

export const checker = createMiddleware(async (c, next) => {
	const requiredEnvVars = ["BOT_TOKEN", "GROUP_ID", "KV"];
	const missingEnvVars = requiredEnvVars.filter((varName) => !c.env[varName]);

	if (missingEnvVars.length > 0) {
		return c.text(
			`Missing environment variables: ${missingEnvVars.join(", ")}`,
			500,
		);
	} else {
		await next();
	}
});
