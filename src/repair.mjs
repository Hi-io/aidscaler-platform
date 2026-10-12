import { check } from "./errors.mjs";
import { hash } from "./store.mjs";
/** A repair is a new prospective decision. Past physical work is never replayed. */
export async function repairContext(store, org, id, actions) {
  if (!id) return { repairOf: null, inheritedWork: [] };
  const old = await store.get(org, "proposal", id);
  check(
    old.state === "requires_review",
    "REPAIR_STATE",
    "Repair only a response with a material change requiring review.",
    409,
  );
  const inherited = [];
  for (const receipt of old.executionResults ?? []) {
    const action = old.actions[receipt.index],
      operationId = receipt.result?.operation ?? receipt.result?.id,
      operation = operationId
        ? await store.get(org, "operation", operationId, false)
        : null;
    const completed =
      (operation?.confirmedBySource &&
        ["received", "completed", "service", "operating"].includes(
          operation.state,
        )) ||
      (receipt.state === "completed" &&
        receipt.partnerResult?.confirmedBySource);
    if (completed) {
      check(
        !actions.some(
          (a) =>
            hash({ type: a.type, owner: a.owner, params: a.params }) ===
            hash({
              type: action.type,
              owner: action.owner,
              params: action.params,
            }),
        ),
        "REPAIR_DUPLICATES_COMPLETED",
        "This repair repeats an already completed physical step. Preserve it as history, and propose only changed future work.",
        409,
      );
      inherited.push({
        index: receipt.index,
        action,
        operationId: operation?.id,
        receipt: receipt.partnerResult ?? operation,
        state: "completed",
      });
    } else if (
      operation &&
      !["failed", "cancelled"].includes(operation.state)
    ) {
      if (operation.confirmedBySource && operation.state === "blocked") {
        check(
          actions.some(
            (a) =>
              a.owner === action.owner &&
              ((a.type === "reroute" &&
                a.params.vehicle === operation.vehicle) ||
                (a.type === "cancel" && a.params.id === operation.id)),
          ),
          "REPAIR_UNADDRESSED",
          "This repair must address the existing blocked trip. A different dispatch does not recover its loaded cargo. Reroute the same vehicle, or request cancellation of this exact operation and wait for physical recovery.",
          409,
        );
      }
      inherited.push({
        index: receipt.index,
        action,
        operationId: operation.id,
        receipt: operation,
        state: "still_in_progress",
      });
    }
  }
  return {
    repairOf: id,
    inheritedWork: inherited,
    repairReason: old.changedReason ?? "A material dependency changed",
    previousDecision: old.authorization ?? old.previousAuthorization ?? null,
  };
}
