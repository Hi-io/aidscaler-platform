import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../../disaster-response-simulator/engine/world.mjs";
import {
  capturePhysicalDepartures,
  operationTrace,
} from "../evaluation/physical-trace.mjs";

test("scorer departure tracing preserves the physical world's deterministic behavior and source operation identity", () => {
  const config = {
      scenario: "S23",
      seed: "physical-trace-01",
      postsPerHour: 0,
      backgroundTraffic: 0,
    },
    control = new World(config),
    traced = new World(config),
    departures = capturePhysicalDepartures(traced);
  function execute(w) {
    const vehicle = w.vehicle("v-org0-0"),
      destination = w.organization("org1").node,
      operation = {
        id: "test-trip",
        org: "org0",
        type: "delivery",
        need: "test-need",
        vehicle: vehicle.id,
        resource: "r-org0-water",
        resourceType: "water",
        quantity: 10,
        received: 0,
        destination,
        state: "authorized",
        times: { authorized: w.now },
      };
    w.state.operations.push(operation);
    w.startTrip(vehicle, destination, operation);
    w.advance(600000);
    return operation;
  }
  execute(control);
  const operation = execute(traced);
  assert.equal(traced.stateHash(), control.stateHash());
  const ownDepartures = departures.filter((d) => d.operation === "test-trip");
  assert.equal(ownDepartures.length, 1);
  assert.equal(ownDepartures[0].need, "test-need");
  assert.equal(ownDepartures[0].routeNodes.at(-1), operation.destination);
  assert.ok(ownDepartures[0].routeEdges.length > 0);
  assert.ok(ownDepartures[0].distanceM > 0);
  assert.equal(operationTrace(operation).times.dispatched, 0);
  assert.equal(operationTrace(operation).resourceType, "water");
});
