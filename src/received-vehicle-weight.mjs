import { check } from "./errors.mjs";
import { receivedCargoProfile } from "./received-cargo.mjs";

const nonnegative = (value) => Number.isFinite(value) && value >= 0;
const cargoTypes = new Set([
  "water",
  "food",
  "blankets",
  "energy",
  "sanitation",
  "staff",
  "fuel",
  "rescue",
]);
const terminal = new Set([
  "received",
  "completed",
  "service",
  "returned",
  "cancelled",
  "unloaded",
]);

/** Conservative gross mass from this owner's received vehicle/operation only.
 * A returning recovery still carries its cargo until a real return receipt.
 * No source clock, private vehicle object or future capacity is consulted. */
export function receivedVehicleWeight(vehicle, operation, resource = null) {
  check(
    operation?.confirmedBySource === true &&
      operation.vehicle === vehicle?.id &&
      (!vehicle.operation || vehicle.operation === operation.id),
    "VEHICLE_LOAD_SCOPE",
    "Obtain the current received operation for this vehicle before checking its loaded route.",
    409,
  );
  const v = vehicle.sourceSnapshot ?? vehicle,
    o = operation.sourceSnapshot ?? operation;
  check(
    nonnegative(v.weightKg),
    "VEHICLE_WEIGHT_UNKNOWN",
    "Query the owner's vehicle mass before checking its route.",
    409,
  );
  const quantity = nonnegative(o.quantity) ? o.quantity : null;
  const fullyReceived =
    quantity !== null && nonnegative(o.received) && o.received >= quantity;
  const emptyReceipt =
    terminal.has(o.state) ||
    Number.isFinite(o.times?.returned) ||
    fullyReceived;
  const emptyPickup =
    o.phase === "pickup" &&
    !Number.isFinite(o.times?.prepared) &&
    o.state !== "loading";
  const emptyWork = ["inspection", "repair"].includes(o.type);
  const emptyBeforeIssue =
    ["authorized", "reserved", "instruction_pending", "preparing"].includes(
      o.state,
    ) && !Number.isFinite(o.times?.prepared);
  let cargoKg = 0,
    passengerKg = 0,
    basis = "received_empty_phase";
  if (!(emptyReceipt || emptyPickup || emptyWork || emptyBeforeIssue)) {
    if (o.type === "evacuation") {
      check(
        quantity !== null,
        "VEHICLE_LOAD_UNKNOWN",
        "Receive the passenger quantity before checking an occupied evacuation route.",
        409,
      );
      const passengers = Math.max(
        quantity,
        nonnegative(v.passengers) ? v.passengers : 0,
      );
      passengerKg = passengers * 75;
      basis = "received_evacuation_quantity";
    } else {
      const remaining =
        quantity === null
          ? null
          : Math.max(0, quantity - (nonnegative(o.received) ? o.received : 0));
      const load =
        remaining === null
          ? null
          : Math.max(remaining, nonnegative(v.load) ? v.load : 0);
      const profile = receivedCargoProfile(resource && resource.type === o.resourceType
        ? resource : { type: o.resourceType, ...(o.transport ? { transport: o.transport } : {}) });
      if (load !== null && cargoTypes.has(o.resourceType) && profile) {
        cargoKg = load * profile.massKgPerUnit;
        basis = "received_cargo_quantity";
      } else {
        check(
          nonnegative(v.maxCargoKg),
          "VEHICLE_LOAD_UNKNOWN",
          "Receive cargo type/quantity or an approved vehicle cargo mass bound before checking this route.",
          409,
        );
        cargoKg = v.maxCargoKg;
        basis = "received_cargo_mass_bound";
      }
      if (nonnegative(v.passengers)) passengerKg = v.passengers * 75;
    }
  }
  const crewKg = !emptyReceipt && nonnegative(v.crewQuantity) ? v.crewQuantity * 75 : 0;
  const weightKg = v.weightKg + cargoKg + passengerKg + crewKg;
  check(
    Number.isFinite(weightKg),
    "VEHICLE_LOAD_UNKNOWN",
    "The received gross vehicle mass is invalid.",
    409,
  );
  return {
    weightKg,
    emptyWeightKg: v.weightKg,
    cargoKg,
    passengerKg,
    crewKg,
    basis,
    sourceOperation: operation.id,
    phase: o.phase ?? null,
  };
}
