import { displayModel } from "./presentation.mjs";

export function workStatusIcon(state, active = 0) {
  return state === "queued" ? "clock" : active > 0 && ["reading", "checking"].includes(state) ? "loader-circle" : "check";
}

export function monitorState(intake = {}, pulse = {}) {
  const active = Number(pulse.flows?.active ?? intake.runtime?.active ?? 0), queued = Number(pulse.flows?.queued ?? intake.runtime?.queued ?? 0);
  return { active, queued, state: intake.runtime?.state ?? (intake.policy?.enabled ? "monitoring" : "paused"),
    pending: Number(intake.counts?.pending ?? 0), enabled: !!intake.policy?.enabled,
    lastHour: Number(pulse.flows?.lastHour ?? 0), lastMinute: Number(pulse.flows?.lastMinute ?? 0) };
}
export function monitorTitle(intake, pulse, model) {
  const m = monitorState(intake, pulse), name = displayModel(model);
  return m.active ? `${name} is investigating` : m.state === "budget_limit" ? "Model budget reached" : m.queued && m.enabled
    ? `${m.queued} ${m.queued === 1 ? "investigation" : "investigations"} queued` : m.enabled ? `${name} is watching for new reports` : "Automatic investigation is paused";
}
export function agentMonitor(intake, {escape:e, icon, model, compact = false, pulse = {}} = {}) {
  const m = monitorState(intake, pulse), latest = pulse.recent?.[0];
  const fallback = m.state === "budget_limit" ? "Source collection continues while the model budget is paused." : m.enabled
    ? "New reports enter the processing queue automatically." : "Source collection continues. A coordinator can resume the agent in settings.";
  return `<section class="agent-monitor ${m.active ? "working" : ""} ${compact ? "compact" : ""}" data-agent-monitor aria-label="Agent service status"><button class="agent-monitor-open" data-action="navigate" data-id="investigations" aria-label="View agent activity"><span class="agent-monitor-mark">${icon("sparkles")}</span><span class="agent-monitor-content"><span class="agent-monitor-heading"><strong data-agent-title>${e(monitorTitle(intake, pulse, model))}</strong><span class="agent-monitor-link">View activity ${icon("arrow-up-right")}</span></span><span class="agent-monitor-stats"><span data-agent-active>${m.active} active ${m.active === 1 ? "workflow" : "workflows"}</span><span data-agent-hour>${m.lastHour.toLocaleString("en-US")} flows started · last hour</span><span class="agent-monitor-queue" data-agent-queued>${m.queued ? `${m.queued} queued` : m.lastMinute ? `${m.lastMinute} started in the last minute` : "Live monitoring"}</span></span><span class="agent-work-window" data-work-window aria-live="off"><span class="agent-work-item" data-work-key="${e(latest?.eventKey ?? "idle")}">${icon(latest ? "check" : "radio")}<span>${e(latest?.label ?? fallback)}</span></span></span></button></section>`;
}
