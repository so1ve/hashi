import { createMiddleware } from "hono/factory";

export const envChecker = createMiddleware(async (c, next) => {
	const requiredEnvVars = ["BOT_TOKEN", "CHAT_ID"];
	const missingEnvVars = requiredEnvVars.filter((varName) =>
		!Deno.env.get(varName)
	);

	if (missingEnvVars.length > 0) {
		return c.text(
			`Missing environment variables: ${missingEnvVars.join(", ")}`,
			500,
		);
	} else {
		await next();
	}
});
