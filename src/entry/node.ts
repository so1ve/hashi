#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { applyMigrations, openNodeSqlite } from "../db/node.ts";
import { createApp } from "../server/app.ts";
import { loadConfig } from "../server/config.ts";

const DEFAULT_PUBLIC_DIR = path.resolve(import.meta.dirname, "../../public");
const STATIC_ASSET_PATHS = ["/styles.css", "/verify.js", "/setup.js"] as const;

const FILE_BACKED_ENV_KEYS = [
  "BOT_TOKEN",
  "WEBHOOK_SECRET",
  "TURNSTILE_SECRET_KEY",
] as const;

export interface NodeServerOptions {
  host?: string | undefined;
  port?: number | undefined;
  dbPath?: string | undefined;
  env?: Record<string, string | undefined>;
}

export interface RunningNodeServer {
  host: string;
  port: number;
  close: () => Promise<void>;
}

export function resolveEnvWithFiles(
  rawEnv: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const resolved = { ...rawEnv };
  for (const key of FILE_BACKED_ENV_KEYS) {
    if (!resolved[key]?.trim()) {
      const filePath = resolved[`${key}_FILE`]?.trim();
      if (filePath) {
        resolved[key] = fs.readFileSync(filePath, "utf8").trim();
      }
    }
  }

  return resolved;
}

export async function startNodeServer(
  options: NodeServerOptions = {},
): Promise<RunningNodeServer> {
  const env = resolveEnvWithFiles(options.env ?? process.env);
  const host = options.host ?? env.HOST?.trim() ?? "127.0.0.1";
  const port = options.port ?? Number.parseInt(env.PORT ?? "8787", 10);
  const dbPath =
    options.dbPath?.trim() || env.HASHI_DB_PATH?.trim() || "./hashi.db";

  const config = await loadConfig(env);
  const db = openNodeSqlite(dbPath);
  const applied = await applyMigrations(db);
  if (applied.length > 0) {
    console.log(
      JSON.stringify({ message: "applied database migrations", applied }),
    );
  }

  const app = new Hono();
  const staticHandler = serveStatic({ root: DEFAULT_PUBLIC_DIR });
  for (const assetPath of STATIC_ASSET_PATHS) {
    app.use(assetPath, staticHandler);
  }
  app.route(
    "/",
    createApp(() => ({ db, config })),
  );

  const server = await new Promise<ReturnType<typeof serve>>(
    (resolve, reject) => {
      const instance = serve({ fetch: app.fetch, hostname: host, port }, () =>
        resolve(instance),
      );
      instance.once("error", reject);
    },
  );

  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;

  console.log(
    JSON.stringify({
      message: "hashi server listening",
      host,
      port: actualPort,
      db: dbPath,
      public_base_url: config.publicBaseUrl,
      turnstile_configured: config.turnstile !== null,
    }),
  );

  return {
    host,
    port: actualPort,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          db.close();
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        if ("closeAllConnections" in server) {
          server.closeAllConnections();
        }
      }),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const { values } = parseArgs({
    options: {
      host: { type: "string" },
      port: { type: "string" },
      db: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(
      "Usage: node src/entry/node.ts [--host 127.0.0.1] [--port 8787] [--db ./hashi.db]",
    );
    process.exit(0);
  }

  const running = await startNodeServer({
    host: values.host,
    port: values.port ? Number.parseInt(values.port, 10) : undefined,
    dbPath: values.db,
  });

  function shutdown() {
    void running.close().finally(() => process.exit(0));
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
