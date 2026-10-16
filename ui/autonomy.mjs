import { displayModel } from "./presentation.mjs";

export function monitorState(intake = {}) {
  const active = Number(intake.runtime?.active ?? 0), queued = Number(intake.runtime?.queued ?? 0);
  const state = intake.runtime?.state ?? (intake.policy?.enabled ? "monitoring" : "paused");
  return { active, queued, state, pending: Number(intake.counts?.pending ?? 0), processed: Number(intake.counts?.investigated ?? 0), enabled: !!intake.policy?.enabled };
}

export function agentMonitor(intake, {escape:e,icon,model,compact=false} = {}) {
  const m=monitorState(intake), name=displayModel(model);
  const title = m.active ? `${name} is investigating` : m.state==="budget_limit" ? "Model budget reached" : m.queued && m.enabled ? `${m.queued} ${m.queued===1?"investigation":"investigations"} queued` : m.enabled ? `${name} is watching for new reports` : "Automatic investigation is paused";
  const detail = m.active ? `${m.active} ${m.active===1?"investigation":"investigations"} running${m.queued ? ` · ${m.queued} queued` : ""}` : m.state==="budget_limit" ? "Source collection continues. Review processing limits in settings." : m.queued && m.enabled ? "New work is in the processing queue. Source collection continues." : m.enabled ? `${m.processed ? `${m.processed} source groups processed · ` : ""}New reports are collected and grouped automatically.` : "Source collection continues. A coordinator can resume the agent in settings.";
  return `<section class="agent-monitor ${m.active?"working":""} ${compact?"compact":""}" aria-label="Agent service status"><div class="agent-monitor-mark">${icon("sparkles")}</div><div class="grow"><strong>${e(title)}</strong><span>${e(detail)}</span></div>${!compact && m.pending ? `<span class="agent-queue-count">${m.pending} source ${m.pending===1?"group":"groups"} waiting</span>` : ""}<button class="quiet" data-action="navigate" data-id="investigations">View activity ${icon("arrow-up-right")}</button></section>`;
}
