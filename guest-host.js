// Per-guest subdomains: benjamin.ninasevo.co opens Benjamin's invitation.
// Loaded in <head>, before the page's own script, which reads the guest from the #hash.
// We hand it the subdomain as the hash; rsvp.js removes it from the address bar again afterwards.
(function () {
  var BASE = "ninasevo.co";
  var host = location.hostname.toLowerCase();
  if (host.slice(-(BASE.length + 1)) !== "." + BASE) return;
  var sub = host.slice(0, -(BASE.length + 1));
  if (!sub || sub === "www" || sub.indexOf(".") !== -1) return;
  window.GUEST_FROM_HOST = sub;
  history.replaceState(null, "", location.pathname + location.search + "#" + sub);
})();
