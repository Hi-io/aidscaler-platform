import { monitorState, monitorTitle, workStatusIcon } from "./autonomy.mjs";
import { activitySummary } from "./activity.mjs";

export function newItemsSince(baseline, current, kind) {
  if (!baseline || !current || baseline.runId !== current.runId) return 0;
  const before = kind === "signal" ? baseline.signals?.received : baseline.flows?.total;
  const after = kind === "signal" ? current.signals?.received : current.flows?.total;
  if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || before < 0 || after < 0) return 0;
  return Math.max(0, after - before);
}
export function freshnessNotice(kind, {icon} = {}) {
  return `<div class="freshness-slot" data-freshness="${kind}"><button class="freshness-button" data-action="refresh-live" hidden>${icon("refresh-cw")}<span data-freshness-text></span><strong>Load latest ${icon("arrow-up-right")}</strong></button><span class="freshness-current" data-freshness-current>${icon("radio")}Live monitoring · this view stays in place</span></div>`;
}
/** Patch live labels only. Polling never replaces reading lists or expanded evidence. */
export function createLiveWorkspace({api, state, escape:e, icon, renderActivityMetadata}) {
  const baselines = new Map(), seenEvents = new Set();
  let latestIntake = {}, intakeAt = 0, visibleActivities = new Map();
  function rememberPolicy(intake) {latestIntake=intake;intakeAt=Date.now();}
  function capture(kind, pulse, rows = []) {
    baselines.set(kind, pulse);
    if (kind === "activity") visibleActivities = new Map(rows.map(row => [row.id, row]));
  }
  function paintMonitor(root, pulse, intake = latestIntake) {
    latestIntake = intake;
    const m = monitorState(intake, pulse);
    root.querySelectorAll('[data-agent-monitor]').forEach(monitor => {
      monitor.classList.toggle("working", m.active > 0);
      monitor.querySelector('[data-agent-title]').textContent = monitorTitle(intake, pulse, state.model);
      monitor.querySelector('[data-agent-active]').textContent = `${m.active} active ${m.active === 1 ? "workflow" : "workflows"}`;
      monitor.querySelector('[data-agent-hour]').textContent = `${m.lastHour.toLocaleString("en-US")} flows started · last hour`;
      monitor.querySelector('[data-agent-queued]').textContent = m.queued ? `${m.queued} queued` : `${m.lastMinute} started in the last minute`;
      const window = monitor.querySelector('[data-work-window]');
      for (const row of window.querySelectorAll('[data-work-key]')) {
        seenEvents.add(row.dataset.workKey);
        const current = (pulse.recent ?? []).find(event=>event.id===row.dataset.workFlow);
        if(current || !m.active) {
          const glyph=row.querySelector('svg');
          if(glyph)glyph.outerHTML=icon(workStatusIcon(current?.state,m.active));
        }
      }
      const previous = new Map([...window.children].map(row=>[row,row.getBoundingClientRect().top]));
      const events = (pulse.recent ?? []).filter(event => !seenEvents.has(event.eventKey)).slice(0, 3).reverse();
      for (const event of events) {
        seenEvents.add(event.eventKey);
        if(window.lastElementChild?.dataset.workLabel===event.label)continue;
        const row = document.createElement('span'); row.className = 'agent-work-item arriving'; row.dataset.workKey = event.eventKey;
        row.dataset.workLabel=event.label; row.dataset.workFlow=event.id;
        row.innerHTML = `${icon(workStatusIcon(event.state,m.active))}<span>${e(event.label)}</span>`;
        window.append(row);
      }
      while (window.children.length > 3) window.firstElementChild.remove();
      window.classList.toggle('has-history', window.children.length > 1);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) for(const [row,top] of previous)
        if(row.isConnected) row.animate([{transform:`translateY(${top-row.getBoundingClientRect().top}px)`},{transform:'translateY(0)'}],{duration:380,easing:'ease-out'});
    });
    if (seenEvents.size > 500) { seenEvents.clear(); for (const event of pulse.recent ?? []) seenEvents.add(event.eventKey); }
  }
  function paintFreshness(root, pulse) {
    root.querySelectorAll('[data-freshness]').forEach(slot => {
      const kind = slot.dataset.freshness, count = newItemsSince(baselines.get(kind), pulse, kind), button = slot.querySelector('button');
      button.hidden = !count; slot.querySelector('[data-freshness-current]').hidden = !!count;
      slot.querySelector('[data-freshness-text]').textContent = kind === 'signal' ? `${count.toLocaleString('en-US')} new ${count === 1 ? 'signal' : 'signals'} collected` : `${count.toLocaleString('en-US')} new ${count === 1 ? 'flow' : 'flows'} started`;
    });
  }
  async function updateVisibleActivity(root, pulse) {
    const meta = new Map((pulse.recent ?? []).map(a => [a.id, a]));
    for (const [id, old] of visibleActivities) {
      const found = meta.get(id);
      if (found && found.version === old.version) continue;
      if (!found && !['reading','checking','queued'].includes(old.state)) continue;
      const row = await api('/api/records?' + new URLSearchParams({kind:'activity',id}));
      visibleActivities.set(id,row);
      const summary = activitySummary(row,{model:state.model});
      root.querySelectorAll('[data-live-activity]').forEach(element => {
        if (element.dataset.liveActivity !== id) return;
        element.dataset.state=summary.state; element.dataset.busy=String(summary.busy);
        const badge=element.querySelector('[data-live-activity-state]'); if(badge) badge.textContent=summary.title;
        const headline=element.querySelector('.activity-focus, h3');if(headline)headline.textContent=summary.latest;
        const progress=element.querySelector('[data-live-activity-progress]');
        const visibleSteps=element.querySelector('.activity-timeline')?.children.length ?? (old.steps??[]).length;
        if(progress) progress.textContent=summary.steps.length>visibleSteps ? `${summary.steps.length-visibleSteps} new recorded steps · open activity for the latest results` : summary.busy ? 'Processing this investigation' : '';
        const metadata=element.querySelector('.activity-meta');if(metadata&&renderActivityMetadata)metadata.outerHTML=renderActivityMetadata(row);
        const historySummary=element.querySelector('.activity-disclosure > summary');
        if(historySummary&&summary.steps.length>visibleSteps)historySummary.firstChild.textContent=`${visibleSteps} steps in this snapshot`;
        element.querySelectorAll('[data-action="stop-inquiry"]').forEach(button=>{button.hidden=!summary.stoppable;});
        if(row.erasure)element.querySelectorAll('.activity-disclosure,.activity-context,.activity-evidence,.activity-meta').forEach(part=>part.remove());
      });
    }
  }
  async function poll(root) {
    const pulse = await api('/api/workspace-pulse');
    if(Date.now()-intakeAt>30000) { latestIntake=await api('/api/automation');intakeAt=Date.now(); }
    paintMonitor(root,pulse,latestIntake); paintFreshness(root,pulse);
    if(state.page==='investigations') await updateVisibleActivity(root,pulse);
    return pulse;
  }
  return { capture, rememberPolicy, paintMonitor, poll };
}
