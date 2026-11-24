#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { resolveEnvWithFiles } from "../entry/node.ts";
import { setupBot } from "../server/bot.ts";
import { loadConfig, resolveBaseUrl } from "../server/config.ts";
import { TelegramClient } from "../telegram/client.ts";

function loadDotEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

const fromFile = loadDotEnvFile(path.resolve(process.cwd(), ".dev.vars"));
const mergedEnv = resolveEnvWithFiles({ ...fromFile, ...process.env });
const config = await loadConfig(mergedEnv);
const baseUrl = resolveBaseUrl(config);
const telegram = new TelegramClient(config.botToken, config.telegramApiBaseUrl);

const report = await setupBot({ config, telegram, baseUrl });
console.log(
  JSON.stringify({ message: "hashi setup complete", ...report }, null, 2),
);
