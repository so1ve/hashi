import { createMiddleware } from "hono/factory";

export const errorHandler = createMiddleware(async (c, next) => {
	try {
		await next();
	} catch (err) {
		console.error("Error occurred:", err);

		return c.json(err, 500);
	}
});
