import { html, raw } from "hono/html";

import manifest from "../../../package.json" with { type: "json" };
import type { StatsSummary } from "../../db/index.ts";

export interface StatusPageData {
  baseUrl: string;
  turnstileConfigured: boolean;
  verificationEnabled: boolean;
  stats: StatsSummary;
}

export function renderUnconfiguredPage(baseUrl: string, missingError: string) {
  const host = new URL(baseUrl).host;

  return html`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>橋 Hashi - ${host}</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <div class="wrap">
          <header class="head">
            <div class="brand">
              <h1>橋 Hashi</h1>
              <span class="mono muted">${host}</span>
              <span class="status-pill warn">
                <span class="dot" aria-hidden="true"></span>
                Setup required
              </span>
            </div>
          </header>

          <main>
            <div class="notice error" role="alert">${missingError}</div>

            <section class="section" aria-labelledby="setup-heading">
              <div class="sec-head">
                <h2 id="setup-heading">Required variables</h2>
              </div>
              <dl class="kv-list">
                <div class="kv-row">
                  <dt class="mono">BOT_TOKEN</dt>
                  <dd class="muted">Telegram bot token from @BotFather</dd>
                </div>
                <div class="kv-row">
                  <dt class="mono">GROUP_ID</dt>
                  <dd class="muted">
                    Negative supergroup ID with Topics enabled
                  </dd>
                </div>
                <div class="kv-row">
                  <dt class="mono">TURNSTILE_SITE_KEY / SECRET_KEY</dt>
                  <dd class="muted">Optional · Cloudflare Turnstile keys</dd>
                </div>
              </dl>
            </section>
          </main>

          <footer class="foot">
            <div>
              <a
                href="https://github.com/so1ve/hashi"
                target="_blank"
                rel="noopener noreferrer"
              >
                Hashi
              </a>
              <span class="mono faint">v${manifest.version}</span>
            </div>
            <nav class="foot-links" aria-label="Links">
              <a class="mono" href="/healthz">healthz</a>
              <a
                href="https://github.com/so1ve/hashi"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
            </nav>
          </footer>
        </div>
      </body>
    </html>
  `;
}

export function renderStatusPage(data: StatusPageData) {
  const host = new URL(data.baseUrl).host;

  return html`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>橋 Hashi - ${host}</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <div class="wrap">
          <header class="head">
            <div class="brand">
              <h1>橋 Hashi</h1>
              <span class="mono muted">${host}</span>
              <div class="head-actions">
                <span class="status-pill">
                  <span class="dot" aria-hidden="true"></span>
                  Operational
                </span>
                <button
                  type="button"
                  id="setup-toggle-btn"
                  class="link-btn"
                  aria-expanded="false"
                  aria-controls="setup-form"
                >
                  Register webhook
                </button>
              </div>
            </div>
            <div class="summary-line" aria-label="Bot summary">
              <span>
                <strong>${data.stats.activeTopics}</strong>
                topics
              </span>
              <span>
                <strong>${data.stats.totalUsers}</strong>
                users
              </span>
              <span>
                Turnstile
                <strong>
                  ${
                    data.turnstileConfigured
                      ? data.verificationEnabled
                        ? "active"
                        : "ready"
                      : "unconfigured"
                  }
                </strong>
              </span>
            </div>

            <form id="setup-form" class="setup-drawer" hidden>
              <label class="sr-only" for="setup-token-input">
                Bot token or webhook secret
              </label>
              <input
                id="setup-token-input"
                type="password"
                placeholder="BOT_TOKEN or WEBHOOK_SECRET"
                autocomplete="off"
              />
              <button type="submit" id="setup-submit-btn" class="btn-outline">
                Register
              </button>
            </form>
            <div id="setup-notice" class="notice" role="status" hidden></div>
          </header>

          <main>
            <section class="section" aria-labelledby="endpoints-heading">
              <div class="sec-head">
                <h2 id="endpoints-heading">Endpoints</h2>
              </div>
              <dl class="kv-list">
                <div class="kv-row">
                  <dt>Telegram webhook</dt>
                  <dd class="mono">${data.baseUrl}/webhook</dd>
                </div>
                <div class="kv-row">
                  <dt>Verification Mini App</dt>
                  <dd class="mono">${data.baseUrl}/verify</dd>
                </div>
                <div class="kv-row">
                  <dt>Health check</dt>
                  <dd class="mono">/healthz</dd>
                </div>
              </dl>
            </section>
          </main>

          <footer class="foot">
            <div>
              <a
                href="https://github.com/so1ve/hashi"
                target="_blank"
                rel="noopener noreferrer"
              >
                Hashi
              </a>
              <span class="mono faint">v${manifest.version}</span>
            </div>
            <nav class="foot-links" aria-label="Links">
              <a class="mono" href="/healthz">healthz</a>
              <a
                href="https://github.com/so1ve/hashi"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
            </nav>
          </footer>
        </div>
        <script src="/setup.js" defer></script>
      </body>
    </html>
  `;
}

export interface VerifyPageData {
  status: "ready" | "invalid" | "unconfigured";
  siteKey?: string;
  stateToken?: string;
  action?: string;
}

const safeJsonForScript = (value: unknown): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

export function renderVerifyPage(data: VerifyPageData) {
  if (data.status !== "ready") {
    const message =
      data.status === "unconfigured"
        ? "Human verification is not configured on this bot."
        : "This verification link is invalid or has expired. Return to the chat and tap Verify again.";

    return html`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1, viewport-fit=cover"
          />
          <title>Verification · Hashi</title>
          <link rel="stylesheet" href="/styles.css" />
          <script src="https://telegram.org/js/telegram-web-app.js"></script>
        </head>
        <body class="verify-body">
          <main class="verify-shell">
            <div class="verify-header">
              <h1 class="verify-title">Human verification</h1>
            </div>
            <p class="verify-status" data-state="error" role="alert">
              ${message}
            </p>
            <div class="verify-actions">
              <button type="button" id="close-btn" class="btn">
                Return to chat
              </button>
            </div>
          </main>
          <script>
            (function () {
              var tg = window.Telegram && window.Telegram.WebApp;
              if (tg) tg.ready();
              var btn = document.getElementById("close-btn");
              if (btn) {
                btn.addEventListener("click", function () {
                  if (tg && typeof tg.close === "function") tg.close();
                });
              }
            })();
          </script>
        </body>
      </html>
    `;
  }

  const clientConfig = safeJsonForScript({
    siteKey: data.siteKey,
    state: data.stateToken,
    action: data.action ?? "hashi_verify",
  });

  return html`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <title>Verification · Hashi</title>
        <link rel="preconnect" href="https://challenges.cloudflare.com" />
        <link rel="stylesheet" href="/styles.css" />
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onHashiTurnstileLoad"
          async
          defer
        ></script>
      </head>
      <body class="verify-body">
        <main class="verify-shell">
          <div class="verify-header">
            <h1 class="verify-title">Human verification</h1>
          </div>
          <div id="turnstile-widget" class="verify-widget"></div>
          <p id="verify-status" class="verify-status" role="status">
            Loading verification…
          </p>
          <div class="verify-actions">
            <button type="button" id="retry-btn" class="btn" hidden>
              Try again
            </button>
            <button type="button" id="close-btn" class="btn" hidden>
              Return to chat
            </button>
          </div>
        </main>
        <script id="verify-config" type="application/json">
          ${raw(clientConfig)}
        </script>
        <script src="/verify.js" defer></script>
      </body>
    </html>
  `;
}
