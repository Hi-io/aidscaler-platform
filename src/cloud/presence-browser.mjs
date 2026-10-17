// Loaded only inside the managed demo workspace, never on the landing page.
let demoCsrf, presenceBusy = false;
async function reportPresence() {
  if (document.hidden || presenceBusy) return;
  presenceBusy = true;
  try {
    if (!demoCsrf) {
      const session = await fetch('/demo/api/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!session.ok) return;
      demoCsrf = (await session.json()).csrf;
    }
    const result = await fetch('/demo/api/presence', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': demoCsrf }, body: JSON.stringify({ visible: true }) });
    if (result.status === 403) demoCsrf = null;
  } catch { /* Existing connection status remains responsible for visible errors. */ }
  finally { presenceBusy = false; }
}
setInterval(reportPresence, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) reportPresence(); });
reportPresence();
