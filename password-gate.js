(function () {
  const STORED_HASH = "49733ab3453b0232e1e91203ba5a3b1b8df66c790e7c3f67377600ace2cf7dc3";
  const SESSION_KEY = "presco-office-search-authed";

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function showApp() {
    document.getElementById("gate").hidden = true;
    document.getElementById("app").hidden = false;
    document.dispatchEvent(new Event("presco:authed"));
  }

  // Deferred to DOMContentLoaded so app.js (loaded after this script) has
  // already registered its "presco:authed" listener by the time this can
  // fire for an already-authenticated session.
  document.addEventListener("DOMContentLoaded", () => {
    if (sessionStorage.getItem(SESSION_KEY) === "1") {
      showApp();
    }
  });

  document.getElementById("gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("gate-password").value;
    const hash = await sha256Hex(input);
    const errorEl = document.getElementById("gate-error");
    if (hash === STORED_HASH) {
      sessionStorage.setItem(SESSION_KEY, "1");
      errorEl.hidden = true;
      showApp();
    } else {
      errorEl.hidden = false;
    }
  });
})();
