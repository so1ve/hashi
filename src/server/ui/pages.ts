import { html, raw } from "hono/html";

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
