/** Scorer-only observation of source-selected departure paths. Nothing here is
 * an actor input, planning hint, clock advance or mutation of physical state.
 * A departure path is not proof that all edges were subsequently traversed. */
export function capturePhysicalDepartures(world) {
  const departures = [],
    original = world.startTrip;
  world.startTrip = (vehicle, destination, operation = null) => {
    const from = vehicle.node,
      started = original(vehicle, destination, operation);
    if (started && operation) {
      const edges = vehicle.route.map((id) => world.edge(id));
      departures.push({
        operation: operation.id,
        owner: operation.org,
        vehicle: vehicle.id,
        need: operation.need ?? null,
        resource: operation.resource ?? null,
        resourceType: operation.resourceType ?? null,
        quantity: operation.quantity ?? null,
        phase: operation.phase ?? operation.type,
        from,
        destination,
        departedAt: world.now,
        expectedArrivalAt: vehicle.eta,
        routeNodes: [from, ...edges.map((e) => e.to)],
        routeEdges: edges.map((e) => e.id),
        distanceM: edges.reduce((sum, e) => sum + e.lengthM, 0),
      });
    }
    return started;
  };
  return departures;
}

export function operationTrace(operation) {
  return {
    id: operation.id,
    sourceId: operation.sourceId ?? operation.id,
    owner: operation.owner ?? operation.org,
    type: operation.type,
    state: operation.state,
    need: operation.need ?? null,
    building: operation.building ?? null,
    resource: operation.resource ?? null,
    resourceType: operation.resourceType ?? null,
    vehicle: operation.vehicle,
    destination:
      operation.destination ?? operation.sourceSnapshot?.destination ?? null,
    quantity: operation.quantity,
    received: operation.received ?? 0,
    createdAt: operation.createdAt,
    times: { ...operation.times },
    sourceObservedAt: operation.sourceObservedAt ?? null,
    confirmedBySource: operation.confirmedBySource ?? false,
  };
}
