(function () {
  const toggleBtn = document.querySelector("#setup-toggle-btn");
  const form = document.querySelector("#setup-form");
  const tokenInput = document.querySelector("#setup-token-input");
  const submitBtn = document.querySelector("#setup-submit-btn");
  const notice = document.querySelector("#setup-notice");

  if (!toggleBtn || !form || !tokenInput || !submitBtn || !notice) {
    return;
  }

  function showNotice(text, kind) {
    notice.textContent = text;
    notice.className = kind ? `notice ${kind}` : "notice";
    notice.hidden = false;
  }

  toggleBtn.addEventListener("click", () => {
    const nextHidden = !form.hidden;
    form.hidden = nextHidden;
    toggleBtn.setAttribute("aria-expanded", String(!nextHidden));
    if (!nextHidden) {
      tokenInput.focus();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) {
      showNotice("Enter BOT_TOKEN or WEBHOOK_SECRET.", "error");
      tokenInput.focus();

      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Registering…";
    notice.hidden = true;

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Setup failed (HTTP ${res.status}).`);
      }
      tokenInput.value = "";
      showNotice(
        `Registered @${data.botUsername} → ${data.webhookUrl} (${data.groupTitle}).`,
        "ok",
      );
    } catch (error) {
      showNotice(
        error instanceof Error && error.message
          ? error.message
          : "Setup failed.",
        "error",
      );
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Register";
    }
  });
})();
