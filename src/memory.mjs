import { check, role } from "./errors.mjs";
import { uid } from "./store.mjs";
export class Memory {
  constructor(store) {
    this.store = store;
  }
  async record(actor, { operation, lesson, conditions }, key) {
    role(actor, ["analyst", "commander", "dispatcher"]);
    return this.store.command(
      actor.org,
      key,
      { operation, lesson, conditions },
      async (tx) => {
        const op = await tx.get(actor.org, "operation", operation);
        check(
          op.confirmedBySource === true &&
            ["received", "completed", "service"].includes(op.state),
          "OUTCOME_REQUIRED",
          "A precedent requires a recorded physical outcome.",
        );
        check(
          Array.isArray(conditions) && conditions.length,
          "REVALIDATION",
          "Specify conditions that must be rechecked.",
        );
        const id = uid("pattern"),
          record = await tx.put(
            actor.org,
            "pattern",
            id,
            {
              operation,
              lesson,
              conditions,
              sourceOutcome: op,
              validatedBy: actor.id,
              state: "requires_revalidation",
            },
            0,
          );
        await tx.audit(actor.org, actor.id, "pattern.recorded", id, {
          operation,
          conditions,
        });
        return record;
      },
    );
  }
  async applicable(org, context) {
    return (await this.store.list(org, "pattern", 100)).map((p) => ({
      ...p,
      eligible: p.conditions.every((c) => context[c.key] === c.equals),
      unmet: p.conditions.filter((c) => context[c.key] !== c.equals),
    }));
  }
}
