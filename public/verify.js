(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
  }

  const configEl = document.querySelector("#verify-config");
  const statusEl = document.querySelector("#verify-status");
  const widgetEl = document.querySelector("#turnstile-widget");
  const retryBtn = document.querySelector("#retry-btn");
  const closeBtn = document.querySelector("#close-btn");

  if (!configEl || !statusEl || !widgetEl) {
    return;
  }

  let config;
  try {
    config = JSON.parse(configEl.textContent || "{}");
  } catch {
    return;
  }

  let widgetId = null;
  let submitting = false;

  function setStatus(text, state) {
    statusEl.textContent = text;
    if (state) {
      statusEl.dataset.state = state;
    } else {
      delete statusEl.dataset.state;
    }
  }

  function showRetry(visible) {
    if (retryBtn) {
      retryBtn.hidden = !visible;
    }
  }

  function showClose(visible) {
    if (closeBtn) {
      closeBtn.hidden = !visible;
    }
  }

  function closeWebApp() {
    if (tg && typeof tg.close === "function") {
      tg.close();
    }
  }

  async function submitToken(turnstileToken) {
    if (submitting) {
      return;
    }
    submitting = true;
    showRetry(false);
    setStatus("Verifying…", "");

    try {
      const res = await fetch("/verify/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: turnstileToken,
          state: config.state,
          initData: tg && typeof tg.initData === "string" ? tg.initData : "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== "ok") {
        throw new Error(data.message || "Verification failed.");
      }

      setStatus("Verified. Returning to chat…", "ok");
      showClose(true);
      setTimeout(closeWebApp, 800);
    } catch (error) {
      const msg =
        error instanceof Error && error.message
          ? error.message
          : "Verification failed. Please try again.";
      setStatus(msg, "error");
      showRetry(true);
      if (widgetId !== null && window.turnstile) {
        window.turnstile.reset(widgetId);
      }
    } finally {
      submitting = false;
    }
  }

  function getTurnstileTheme() {
    if (tg && (tg.colorScheme === "dark" || tg.colorScheme === "light")) {
      return tg.colorScheme;
    }

    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function mountWidget() {
    if (widgetId !== null) {
      return;
    }
    if (!window.turnstile || !config.siteKey) {
      setStatus("Verification widget failed to load. Please retry.", "error");
      showRetry(true);

      return;
    }
    setStatus("Complete the check above.", "");
    widgetId = window.turnstile.render(widgetEl, {
      "sitekey": config.siteKey,
      "action": config.action || "hashi_verify",
      "theme": getTurnstileTheme(),
      "callback": (token) => {
        submitToken(token);
      },
      "expired-callback": () => {
        setStatus("Verification expired. Please try again.", "error");
        showRetry(true);
      },
      "error-callback": () => {
        setStatus("Challenge error. Please try again.", "error");
        showRetry(true);
      },
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      showRetry(false);
      if (widgetId !== null && window.turnstile) {
        setStatus("Complete the check above.", "");
        window.turnstile.reset(widgetId);
      } else {
        mountWidget();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", closeWebApp);
  }

  window.onHashiTurnstileLoad = mountWidget;
  if (window.turnstile) {
    mountWidget();
  }
})();
