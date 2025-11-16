import { env } from "cloudflare:workers";

import type { expectedTables } from "./table";
import D1Wrapper from "./wrapper";

const { DB } = env;

export const db = new D1Wrapper<typeof expectedTables>(DB);

export * from "./settings";
export * from "./users";
