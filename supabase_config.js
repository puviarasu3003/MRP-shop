// supabase_config.js
// Shared Supabase configuration for MRP Mens Wear

(function () {
  "use strict";

  window.SUPABASE_CONFIG = {
    url: "https://tcfbrivmkizszvkkspcd.supabase.co",
    anonKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjZmJyaXZta2l6c3p2a2tzcGNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTU2MDQsImV4cCI6MjA5ODc5MTYwNH0.4FsBBGz-yzM8biuTvUt1_S0pjuLpCmxqPjPALqBPozo",
    options: {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Distinct key so the customer site's session never overlaps
        // with the admin panel's session in the same browser (they'd
        // otherwise share the default "sb-<ref>-auth-token" key since
        // localStorage is per-origin, not per-page).
        storageKey: "sb-mrp-customer-auth",
      },
    },
  };

  if (typeof module !== "undefined") {
    module.exports = window.SUPABASE_CONFIG;
  }
})();
