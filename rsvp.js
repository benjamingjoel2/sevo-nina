// RSVP + guest list via the Google Sheet (Apps Script web app).
// Lives in its own file so the artifact sync never overwrites it; index.html loads it after its own script.
// It plugs into the page's existing `db` and `guest` variables, so the page's RSVP form works unchanged.
(function () {
  // Links made by the Sheet end in 4 random digits (#anna-ben-4821): leave them out of the fallback greeting
  if (/-\d{4}$/.test(guestId) && guest.names === nameFromId(guestId)) {
    guest = { ...guest, names: nameFromId(guestId.replace(/-\d{4}$/, "")) };
    showGuest();
  }

  // Paste the Apps Script web app URL here (Deploy → Manage deployments → Web app URL, ends in /exec)
  const SHEET_URL = "";

  if (!SHEET_URL) return;

  // RSVP form calls db.doc("rsvps/<id>").set({...}) — send that to the Sheet.
  db = {
    doc(path) {
      return {
        async set(data) {
          const res = await fetch(SHEET_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" }, // simple request: no CORS preflight
            body: JSON.stringify(data)
          });
          const out = await res.json();
          if (!out.ok) throw new Error(out.error || "RSVP not saved");
        },
        async get() { return null; }
      };
    }
  };

  // Greet the guest with the details from the "Guests" tab
  fetch(SHEET_URL + "?id=" + encodeURIComponent(guestId))
    .then(r => r.json())
    .then(out => {
      if (out && out.ok && out.guest && out.guest.names) { guest = { ...guest, ...out.guest }; showGuest(); }
    })
    .catch(() => {});
})();
