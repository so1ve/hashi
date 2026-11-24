import { d1Adapter } from "../db/index.ts";
import { createApp } from "../server/app.ts";
import type { ServerRuntimeEnv } from "../server/config.ts";
import { loadConfig } from "../server/config.ts";

export interface CloudflareWorkerEnv extends ServerRuntimeEnv {
  DB: D1Database;
}

const app = createApp<CloudflareWorkerEnv>(async (c) => ({
  db: d1Adapter(c.env.DB),
  config: await loadConfig(c.env),
  waitUntil: (promise) => {
    c.executionCtx.waitUntil(promise);
  },
}));

export default {
  fetch: (request: Request, env: CloudflareWorkerEnv, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
} satisfies ExportedHandler<CloudflareWorkerEnv>;
