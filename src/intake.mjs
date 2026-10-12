import { hash, uid } from "./store.mjs";
import { check, role } from "./errors.mjs";
import { responseQueue } from "./response-policy.mjs";
/** Persistent, bounded intake. Grouping is a queue aid, not a truth verdict. */
export class Intake {
  constructor(store, config) {
    Object.assign(this, { store, config });
  }
  async stage(org, signal, tx = this.store) {
    const id = "group_" + (signal.group ?? hash([signal.id, signal.location])),
      old = await tx.get(org, "intake", id, false);
    if (
      old &&
      !(signal.id in old.versions) &&
      Object.keys(old.versions).length >= 1000
    )
      return this.stage(
        org,
        {
          ...signal,
          sourceGroup: signal.group,
          group: hash([signal.group, signal.id]),
        },
        tx,
      );
    const versions = {
      ...(old?.versions ?? {}),
      [signal.id]: signal.sourceVersion ?? signal.version ?? 1,
    };
    if (old?.versions?.[signal.id] === versions[signal.id]) return;
    const versionHash = hash(versions),
      withdrawn = { ...(old?.withdrawn ?? {}), [signal.id]: !!signal.deleted };
    const priority = signal.location
      ? Number(
          (
            await tx.query(
              "SELECT COALESCE(MAX(CASE WHEN jsonb_typeof(data->'priority')='number' THEN (data->>'priority')::numeric ELSE 0 END),0) AS priority FROM entities WHERE org=$1 AND kind='need' AND (data->>'building'=$2 OR data->>'node'=$2)",
              [org, signal.location],
            )
          ).rows[0].priority,
        )
      : 0;
    await tx.upsert(org, "intake", id, {
      versions,
      versionHash,
      withdrawn,
      scope: "organization",
      state: Object.values(withdrawn).every(Boolean) ? "withdrawn" : "pending",
      priority: Math.max(priority, old?.priority ?? 0),
      firstSeenAt: old?.firstSeenAt ?? Date.now(),
      lastChangedAt: Date.now(),
      attempts: 0,
      grouping:
        "Explicit source relation or location-aware fingerprint; not independent verification",
    });
  }
  async policy() {
    const saved = await this.store.get(
      this.config.org,
      "automation",
      "intake",
      false,
    );
    return {
      enabled: saved?.enabled ?? this.config.autoInvestigate ?? false,
      interpretSources: saved?.interpretSources ?? false,
      maxGroups: saved?.maxGroups ?? 3,
      maxSignals: saved?.maxSignals ?? 35,
      hourlyCallLimit: Math.min(
        saved?.hourlyCallLimit ?? Infinity,
        this.config.hourlyCallLimit ?? 40,
      ),
      hourlyBudgetUsd: Math.min(
        saved?.hourlyBudgetUsd ?? Infinity,
        this.config.hourlyBudgetUsd ?? 2,
      ),
    };
  }
  async configure(actor, input, key) {
    role(actor, ["admin", "commander"]);
    const { enabled } = input;
    check(
      typeof enabled === "boolean",
      "AUTOMATION",
      "Specify enabled or paused.",
    );
    const limits = {};
    for (const [name, maximum, integer] of [
      ["maxGroups", 3, true],
      ["maxSignals", 35, true],
      ["hourlyCallLimit", this.config.hourlyCallLimit ?? 40, true],
      ["hourlyBudgetUsd", this.config.hourlyBudgetUsd ?? 2, false],
    ]) {
      if (input[name] == null) continue;
      check(
        typeof input[name] === "number" &&
          Number.isFinite(input[name]) &&
          input[name] > 0 &&
          input[name] <= maximum &&
          (!integer || Number.isSafeInteger(input[name])),
        "AUTOMATION_LIMIT",
        "Use positive limits within the server's configured maximum.",
      );
      limits[name] = input[name];
    }
    return this.store.command(actor.org, key, input, async (tx) => {
      const row = await tx.upsert(actor.org, "automation", "intake", {
        enabled,
        ...(typeof input.interpretSources === "boolean"
          ? { interpretSources: input.interpretSources }
          : {}),
        ...limits,
        changedBy: actor.id,
      });
      await tx.audit(actor.org, actor.id, "intake.policy", row.id, {
        enabled,
        ...limits,
      });
      return row;
    });
  }
  async kick() {
    const org = this.config.org,
      policy = await this.policy();
    if (!policy.enabled) return { paused: true };
    const queue = await responseQueue(this.store, org, { limit: 100 });
    if (queue.openReviews >= queue.policy.maxOpenReviews)
      return { humanBackpressure: true, openReviews: queue.openReviews };
    return this.store.transaction(async (tx) => {
      await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        org,
      ]);
      const pending = (
        await tx.query(
          "SELECT COUNT(*) AS n FROM jobs WHERE org=$1 AND kind='investigate' AND state IN ('queued','running','retry')",
          [org],
        )
      ).rows[0];
      if (Number(pending.n)) return { busy: true };
      const usage = (
        await tx.query(
          "SELECT COUNT(*) AS calls,COALESCE(SUM(COALESCE(cost_usd,reserved_usd)),0) AS cost FROM usage WHERE org=$1 AND started_at>$2",
          [org, Date.now() - 3600000],
        )
      ).rows[0];
      if (
        Number(usage.calls) >= policy.hourlyCallLimit ||
        Number(usage.cost) >= policy.hourlyBudgetUsd
      )
        return { limited: true };
      const groups = (await tx.list(org, "intake", 10000))
        .filter(
          (g) => g.state === "pending" && (g.nextTryAt ?? 0) <= Date.now(),
        )
        .sort(
          (a, b) => b.priority - a.priority || a.firstSeenAt - b.firstSeenAt,
        )
        .slice(0, policy.maxGroups);
      const proposals = await tx.list(org, "proposal", 2000),
        repair = proposals.find(
          (p) =>
            p.state === "requires_review" &&
            !proposals.some(
              (replacement) =>
                replacement.repairOf === p.id &&
                [
                  "awaiting_review",
                  "needs_clarification",
                  "conditionally_authorized",
                  "authorized",
                  "executing",
                  "awaiting_partner",
                  "requires_review",
                  "completed",
                  "repaired",
                ].includes(replacement.state),
            ),
        ),
        repairSignature = repair
          ? hash([
              queue.signature,
              repair.id,
              repair.version,
              repair.changedReason,
              repair.affectedSteps,
              proposals
                .filter((p) => p.repairOf === repair.id)
                .map((p) => [p.id, p.version, p.state]),
            ])
          : null,
        attempt = await tx.get(org, "response_attempt", "active", false),
        focus = queue.policy.approved
          ? queue.rows.find(
              (n) => !n.pendingProposals.length && !n.investigationDeferred,
            )
          : null,
        responseChanged = repair
          ? attempt?.signature !== repairSignature ||
            attempt?.repairOf !== repair.id
          : focus &&
            (attempt?.signature !== queue.signature ||
              attempt?.needId !== focus.id),
        cooldownElapsed =
          !attempt ||
          Date.now() - attempt.at >= queue.policy.investigationCooldownMs;
      if (!groups.length && !(responseChanged && cooldownElapsed))
        return { empty: true };
      const id = uid("intake"),
        ids = groups
          .flatMap((g) =>
            Object.keys(g.versions).filter(
              (s) => g.processed?.[s] !== g.versions[s],
            ),
          )
          .slice(0, policy.maxSignals),
        selected = groups.filter((g) => ids.some((s) => s in g.versions));
      if (!ids.length && !focus && !repair) return { empty: true };
      for (const g of selected)
        await tx.upsert(org, "intake", g.id, {
          state: "queued",
          jobId: id,
          attempts: (g.attempts ?? 0) + 1,
        });
      await tx.put(
        org,
        "activity",
        id,
        {
          state: "queued",
          model: this.config.modelId,
          steps: [],
          startedAt: Date.now(),
          kind: "automatic_intake",
          proposalId: null,
        },
        0,
      );
      await tx.enqueue(
        org,
        "investigate",
        {
          ids,
          intakeGroups: selected.map((g) => ({
            id: g.id,
            versionHash: g.versionHash,
            ids: ids.filter((s) => s in g.versions),
          })),
          automatic: true,
          focusMode: "automatic",
          interpretSources: policy.interpretSources,
          ...(repair
            ? { repairOf: repair.id }
            : focus
              ? {
                  needId: focus.id,
                  responsePolicyVersion: queue.policy.version,
                }
              : {}),
        },
        id,
      );
      if (repair || focus)
        await tx.upsert(org, "response_attempt", "active", {
          needId: repair ? null : focus.id,
          repairOf: repair?.id ?? null,
          signature: repairSignature ?? queue.signature,
          at: Date.now(),
          jobId: id,
        });
      return { queued: true, id, groups: selected.length, signals: ids.length };
    });
  }
  async complete(payload, result, error) {
    for (const requested of payload.intakeGroups ?? []) {
      const row = await this.store.get(
        this.config.org,
        "intake",
        requested.id,
        false,
      );
      if (!row || row.versionHash !== requested.versionHash) continue;
      const failed = error || result?.state === "failed",
        processed = { ...(row.processed ?? {}) };
      if (!failed)
        for (const id of requested.ids ?? []) processed[id] = row.versions[id];
      const remaining = Object.keys(row.versions).some(
        (id) => processed[id] !== row.versions[id],
      );
      await this.store.upsert(this.config.org, "intake", row.id, {
        processed,
        state:
          result?.state === "cancelled"
            ? "manual_review"
            : failed
              ? row.attempts < 2
                ? "pending"
                : "manual_review"
              : remaining
                ? "pending"
                : "investigated",
        nextTryAt: failed ? Date.now() + 60000 : null,
        proposalId: result?.proposalId ?? null,
        finishedAt: Date.now(),
        error: failed
          ? (error?.code ?? result?.reason ?? "INVESTIGATION_FAILED")
          : null,
      });
    }
  }
  async summary() {
    const groups = await this.store.list(this.config.org, "intake", 10000),
      counts = {};
    for (const g of groups) counts[g.state] = (counts[g.state] ?? 0) + 1;
    return {
      policy: await this.policy(),
      counts,
      groups: groups.length,
      note: "Queue states describe processing, never independently confirmed needs.",
    };
  }
}
