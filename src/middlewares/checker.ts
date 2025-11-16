import { createMiddleware } from "hono/factory";

const requiredVars = ["DB", "BOT_TOKEN", "GROUP_ID"];

export const checker = createMiddleware(async (c, next) => {
	const missingEnvVars = requiredVars.filter((varName) => !c.env[varName]);

	if (missingEnvVars.length > 0) {
		return c.text(
			`Missing environment variables: ${missingEnvVars.join(", ")}`,
			500,
		);
	} else {
		await next();
	}
});
