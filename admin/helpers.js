// helpers.js
// Utility helpers for the MRP Men's Wear Admin Panel

(function () {
  "use strict";

  /**
   * Escapes HTML special characters to prevent XSS.
   * @param {string} s - The string to escape.
   * @returns {string} - The escaped string.
   */
  function esc(s) {
    return s
      ? String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;")
      : "";
  }

  /**
   * Copies the provided text to the clipboard.
   * @param {string} text - The text to copy.
   * @returns {Promise<void>}
   */
  function copyTextToClipboard(text) {
    return new Promise((resolve, reject) => {
      // 1. Try modern navigator.clipboard API if available
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(resolve)
          .catch((err) => {
            // If clipboard permission is denied or fails, try fallback
            console.warn("navigator.clipboard.writeText failed, trying fallback: ", err);
            fallbackCopy(text) ? resolve() : reject(new Error("Clipboard permission denied or copy failed."));
          });
      } else {
        // 2. Fallback to document.execCommand
        fallbackCopy(text) ? resolve() : reject(new Error("Clipboard copy is not supported in this browser."));
      }
    });
  }

  /**
   * Fallback copier using textarea element selection.
   * @param {string} text - The text to copy.
   * @returns {boolean} - True if successful, false otherwise.
   */
  function fallbackCopy(text) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      // Prevent scrolling on mobile devices when appending/focusing
      textArea.style.position = "fixed";
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.width = "2em";
      textArea.style.height = "2em";
      textArea.style.padding = "0";
      textArea.style.border = "none";
      textArea.style.outline = "none";
      textArea.style.boxShadow = "none";
      textArea.style.background = "transparent";
      
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      console.error("Fallback copy execution failed:", err);
      return false;
    }
  }

  // Expose helpers globally on window
  window.esc = esc;
  window.AdminHelpers = {
    esc,
    copyTextToClipboard
  };
})();
