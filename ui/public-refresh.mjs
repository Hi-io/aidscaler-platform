const regions = ["updates", "responseProgress", "finance", "financeReview"];
const snapshot = (data, key) => JSON.stringify(data?.[key] ?? null);

/** Refresh reviewed projections independently; slow reads never create a backlog. */
export function createPublicRefresh({ load, initial, apply, onData, current = () => true }) {
  const applied = new Map(regions.map(key => [key, snapshot(initial, key)]));
  let busy = false, stopped = false;
  return {
    stop() { stopped = true; },
    async poll() {
      if (busy || stopped || !current()) return false;
      busy = true;
      try {
        const data = await load();
        if (stopped || !current()) return false;
        onData?.(data);
        const changed = regions.filter(key => applied.get(key) !== snapshot(data, key));
        if (!changed.length) return false;
        // An active disclosure or focused region can wait for the next poll.
        // Only remember regions the page actually updated.
        const written = await apply(data, changed);
        for (const key of written ?? changed) if (changed.includes(key)) applied.set(key, snapshot(data, key));
        return true;
      } finally { busy = false; }
    },
  };
}

/** Keep disclosure choices and keyboard focus stable while public data changes. */
export function updatePublicRegion(root, selector, markup) {
  const target = root.querySelector(selector);
  if (!target || target.contains(target.ownerDocument.activeElement)) return false;
  const details = [...target.querySelectorAll("details")].map((element, index) => ({
    key: element.dataset.uiKey || `${element.querySelector(":scope > summary")?.textContent.trim() ?? ""}:${index}`,
    open: element.open,
  }));
  target.innerHTML = markup;
  target.querySelectorAll("details").forEach((element, index) => {
    const key = element.dataset.uiKey || `${element.querySelector(":scope > summary")?.textContent.trim() ?? ""}:${index}`;
    const prior = details.find(detail => detail.key === key);
    if (prior) element.open = prior.open;
  });
  return true;
}
