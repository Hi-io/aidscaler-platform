import { check } from "./errors.mjs";
import { hash } from "./store.mjs";
import { validatePlan } from "./planning.mjs";
import { resolveEvidence } from "./citations.mjs";

/** Compile only the actor's received physical receipts. No simulator truth,
 * future roads, partner GPS or new stock is available to this planner. */
export async function checkedRepairPlan(store, config, { proposalId }) {
  const org = config.org,
    prior = await store.get(org, "proposal", proposalId);
  check(
    prior.state === "requires_review",
    "REPAIR_STATE",
    "Select a response that requires renewed review.",
    409,
  );
  const actions = [],
    preserved = [],
    pending = [],
    references = new Set(),
    versions = [];
  for (const receipt of prior.executionResults ?? []) {
    const action = prior.actions[receipt.index];
    if (!action) continue;
    const operationId = receipt.result?.operation ?? receipt.result?.id;
    const operation = operationId
      ? await store.get(org, "operation", operationId, false)
      : null;
    if (!operation?.confirmedBySource) {
      if ((prior.affectedSteps ?? []).includes(receipt.index))
        pending.push({
          index: receipt.index,
          owner: action.owner,
          reason:
            "Current owner-confirmed physical receipt is missing; request the owner's update.",
        });
      continue;
    }
    if (
      ["received", "completed", "service", "operating", "cancelled"].includes(
        operation.state,
      )
    ) {
      preserved.push({
        index: receipt.index,
        operationId,
        state: operation.state,
      });
      continue;
    }
    if (operation.state !== "blocked") {
      pending.push({
        index: receipt.index,
        operationId,
        state: operation.state,
        reason:
          "Preserve existing work. A custom prospective repair requires its current dependencies.",
      });
      continue;
    }
    if (action.owner !== org) {
      pending.push({
        index: receipt.index,
        operationId,
        owner: action.owner,
        reason:
          "Only this vehicle's owner may inspect its private route and prepare a reroute.",
      });
      continue;
    }
    const vehicle = await store.get(org, "vehicle", operation.vehicle, false);
    if (!vehicle || vehicle.owner !== org || !operation.destination) {
      pending.push({
        index: receipt.index,
        operationId,
        reason:
          "Received vehicle or destination is missing; obtain a current owner observation.",
      });
      continue;
    }
    const cargoPickup = ["delivery", "transfer"].includes(operation.type) && operation.phase === "pickup",
      pickupResource = cargoPickup ? await store.get(org, "resource", operation.resource, false) : null;
    if (cargoPickup && (!pickupResource?.node || pickupResource.owner !== org)) {
      pending.push({ index: receipt.index, operationId,
        code: "PICKUP_OBSERVATION", reason: "Receive the exact owned stock location before repairing this empty pickup trip." });
      continue;
    }
    const params = { vehicle: vehicle.id, destination: cargoPickup ? pickupResource.node : operation.destination };
    if (operation.type === "evacuation" && operation.phase !== "pickup")
      params.building = operation.building;
    const reroute = { type: "reroute", owner: org, params, dependsOn: [] };
    try {
      const checks = await validatePlan(store, org, {
        id: null,
        actions: [reroute],
      });
      actions.push(reroute);
      references.add(operation.id);
      references.add(vehicle.id);
      if (pickupResource) references.add(pickupResource.id);
      if (operation.need) references.add(operation.need);
      if (operation.building) references.add(operation.building);
      versions.push({
        operation: operation.id,
        operationVersion: operation.version,
        vehicle: vehicle.id,
        vehicleVersion: vehicle.version,
        checks,
      });
    } catch (e) {
      pending.push({
        index: receipt.index,
        operationId,
        reason: e.message,
        code: e.code,
      });
    }
  }
  const receivedReferences = [];
  for (const id of [...references, ...(prior.references ?? [])])
    if (await resolveEvidence(store, org, id)) receivedReferences.push(id);
  const result = {
    proposalId,
    proposalVersion: prior.version,
    readyToDraft: actions.length > 0 && pending.length === 0,
    actions,
    references: [...new Set(receivedReferences)],
    preserved,
    pending,
    versions,
    note: "A checked reroute preserves the same trip, cargo, destination and responsible owner. Human approval and a source-confirmed physical receipt are still required; no additional allocation is made.",
  };
  return { ...result, planHash: hash(result) };
}
