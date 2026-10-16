import { randomBytes } from "node:crypto";
import { check, role } from "./errors.mjs";
import { hash } from "./store.mjs";
import { publicText } from "./public-safety.mjs";

const tokenValid = (t) => typeof t === "string" && /^[a-zA-Z0-9_-]{32,180}$/.test(t);
export class CommunityFollowup {
  constructor(store, config) { Object.assign(this, { store, config }); }
  async attach(report, suppliedToken) {
    const token = suppliedToken ?? randomBytes(32).toString("base64url");
    check(tokenValid(token), "TRACKING_TOKEN", "Use a valid private tracking reference.");
    const digest = hash(token), org = this.config.org;
    let existingWithoutKey = false;
    await this.store.transaction(async (tx) => {
      await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [org]);
      const old = await tx.get(org, "community_tracking", report.id, false);
      if (old && !suppliedToken) { existingWithoutKey = true; return; }
      check(!old || old.tokenHash === digest, "TRACKING_OWNER", "This report has already been submitted. Use its original private tracking reference.", 409);
      if (!old) await tx.put(org, "community_tracking", report.id, { tokenHash: digest, report: report.id }, 0);
    });
    return existingWithoutKey ? undefined : token;
  }
  async track(token) {
    check(tokenValid(token), "TRACKING_REFERENCE", "Enter the complete private tracking reference.", 404);
    const rows = await this.store.query("SELECT id FROM entities WHERE org=$1 AND kind='community_tracking' AND data->>'tokenHash'=$2 LIMIT 1", [this.config.org, hash(token)]);
    check(rows.rows.length, "TRACKING_REFERENCE", "We could not find that private tracking reference.", 404);
    const report = await this.store.get(this.config.org, "report", rows.rows[0].id, false);
    check(report?.origin === "community-public", "TRACKING_REFERENCE", "We could not find that private tracking reference.", 404);
    const follow = await this.store.get(this.config.org, "community_followup", report.id, false);
    const events = [{ state: "received", title: "Report received", text: "Your report is in the team's private review queue.", at: report.receivedAt }];
    let state = "received";
    if (report.moderatedAt) {
      state = report.state === "rejected" ? "review_completed" : "under_review";
      events.push({ state, title: state === "review_completed" ? "Review completed" : "Team review recorded", text: state === "review_completed" ? "The team has completed its review. This is not a dispatch confirmation." : "Your report has been kept for investigation. This does not yet confirm an operational response.", at: report.moderatedAt });
    }
    for (const event of follow?.updates ?? (follow?.note ? [{ note: follow.note, at: follow.updatedAt }] : [])) events.push({ state: "team_update", title: "Update from the team", text: event.note, at: event.at });
    if (follow?.operation) {
      const op = await this.store.get(this.config.org, "operation", follow.operation, false);
      if (op?.confirmedBySource === true) {
        const assessment = ["assessment", "inspection", "verify"].includes(op.type ?? op.kind);
        const failed = ["failed", "blocked", "cancelled"].includes(op.state);
        const received = Number.isFinite(op.times?.received) && Number.isFinite(op.received) && op.received > 0;
        const moving = ["travelling", "en_route", "in_transit"].includes(op.state);
        if (failed || received || moving) {
          state = failed ? "response_changed" : received ? "supplies_received" : assessment ? "assessment_on_way" : "aid_on_way";
          events.push({ state, title: failed ? "The response needs another look" : received ? "Supplies received" : assessment ? "Assessment team on the way" : "Help is on the way", text: failed ? "The linked operation has changed. The team needs to review the next step." : received ? "A receipt has been recorded for the linked response. This does not yet confirm that every need is met." : assessment ? "A field team is travelling to assess the linked case." : "A source-confirmed response is travelling. Arrival and receipt are still pending.", at: op.updatedAt });
        }
      }
    }
    return { reference: "R-" + hash(report.id).slice(0, 8).toUpperCase(), state, events, updatedAt: Math.max(...events.map(e => Number(e.at) || 0)), notice: "Keep your tracking reference private. Sending a report does not guarantee immediate help." };
  }
  async update(actor, input, key) {
    role(actor, ["analyst", "commander", "dispatcher"]);
    check(typeof input.note === "string" && input.note.trim().length >= 3 && input.note.length <= 1000, "FOLLOWUP_NOTE", "Write a short public-safe update for the person who sent this report.");
    publicText(input.note);
    check(Number.isSafeInteger(input.version) && input.version >= 0, "FOLLOWUP_VERSION", "Refresh this report before updating it.");
    return this.store.command(actor.org, key, input, async tx => {
      const report = await tx.get(actor.org, "report", input.id);
      check(report.origin === "community-public", "FOLLOWUP_REPORT", "Choose a community report.");
      let operation = null;
      if (input.operation) {
        operation = await tx.get(actor.org, "operation", input.operation);
        check(operation.confirmedBySource === true, "FOLLOWUP_OPERATION", "Link an operation already confirmed by the received source.");
      }
      const old = await tx.get(actor.org, "community_followup", report.id, false), now = Date.now();
      const updates = [...(old?.updates ?? (old?.note ? [{ note: old.note, at: old.updatedAt }] : [])), { note: input.note.trim(), at: now }].slice(-20);
      const result = await tx.put(actor.org, "community_followup", report.id, { note: input.note.trim(), updates, operation: operation?.id ?? null, updatedBy: actor.id, reviewedAt: now }, input.version);
      await tx.audit(actor.org, actor.id, "community.followup", report.id, { operation: operation?.id ?? null, version: result.version });
      return result;
    });
  }
}
