import { entityLabel, humanLabel, resourceLabel, vehicleDisplayIdentity } from "./labels.mjs";

const find = (rows, id) =>
  rows instanceof Map
    ? rows.get(id)
    : (rows ?? []).find((row) => row.id === id);
const opaque = (value) =>
  /^(?:user[_-]|human-|scripted-|external-|operation[_-]|r-org\d+-|v-org\d+-|need-|[bn]\d+$|[0-9a-f]{8}-[0-9a-f-]{27}$)/i.test(
    String(value ?? ""),
  );
const named = (value, fallback) => {
  if (!value) return fallback;
  const label = entityLabel(value);
  return label !== value || !opaque(value) ? label : fallback;
};
const nativeUnits = {
  water: "L",
  food: "portions",
  fuel: "L",
  staff: "people",
};
const movingStates = new Set(["dispatched", "travelling", "en_route", "in_transit"]);
const recordedTime = value => Number.isFinite(value) && value >= 0;

/** Presentation uses exact operation scope and permitted received records only. */
export function operationSummary(operation, context = {}) {
  const need = find(context.needs, operation.need),
    resource = find(context.resources, operation.resource),
    vehicle = find(context.vehicles, operation.vehicle),
    type =
      operation.resourceType ??
      operation.sourceSnapshot?.resourceType ??
      resource?.type ??
      need?.type,
    kind = operation.type ?? operation.kind ?? "operation",
    unit =
      operation.unit ||
      operation.sourceSnapshot?.unit ||
      resource?.unit ||
      need?.unit ||
      (["evacuation", "evacuate"].includes(kind)
        ? "people"
        : nativeUnits[type]) ||
      null,
    locationId =
      operation.building ??
      need?.building ??
      operation.destination ??
      need?.node,
    location = named(locationId, "Destination not named"),
    vehicleName =
      (vehicle ? vehicleDisplayIdentity(vehicle).label : null) ||
      named(operation.vehicle, "Assigned response vehicle"),
    owner = named(
      operation.owner ?? operation.org ?? context.organization,
      "Responsible organization",
    ),
    person =
      find(context.people, operation.authorizedBy) ??
      (context.currentUser?.id === operation.authorizedBy
        ? context.currentUser
        : null),
    author =
      person?.name ||
      (operation.authorizedBy
        ? named(operation.authorizedBy, "Authorized coordinator")
        : "Operational source"),
    title = ["delivery", "dispatch"].includes(kind)
      ? `Delivery to ${location}`
      : ["evacuation", "evacuate"].includes(kind)
        ? `Evacuation to ${location}`
        : ["inspection", "assessment", "verify"].includes(kind)
          ? `Field assessment · ${location}`
          : kind === "repair"
            ? `Road repair · ${named(operation.edge, "Affected access road")}`
            : `${humanLabel(kind)}${locationId ? " · " + location : ""}`,
    quantity = Number.isFinite(operation.quantity) ? operation.quantity : null,
    resourceName = type ? resourceLabel({ type }) : null,
    confirmed = operation.confirmedBySource === true,
    times = operation.times ?? {},
    fieldTask = ["inspection", "assessment", "verify", "repair"].includes(kind),
    taskComplete = fieldTask && confirmed && Number.isFinite(times.service),
    receipt = !fieldTask && confirmed && Number.isFinite(times.received),
    arrived = confirmed && Number.isFinite(times.arrived),
    deliveryDeparted = confirmed && operation.phase !== "pickup" && [times.dispatched, times.departed].some(recordedTime),
    moving = deliveryDeparted && movingStates.has(operation.state),
    pickupMoving = confirmed && operation.phase === "pickup" && movingStates.has(operation.state) && recordedTime(times.pickupDispatched),
    received =
      receipt && Number.isFinite(operation.received)
        ? operation.received
        : null;
  return {
    title,
    location,
    vehicle: operation.vehicle ? vehicleName : null,
    owner,
    author,
    unit,
    quantity,
    resourceName,
    received,
    confirmation: taskComplete
      ? kind === "repair" ? "Road repair completed" : "Field visit completed"
      : receipt
      ? "Receipt recorded"
      : arrived
        ? fieldTask ? "At the worksite" : "Arrived · receipt pending"
        : moving
          ? "On the way"
          : pickupMoving
            ? ["evacuation", "evacuate"].includes(kind) ? "Collecting people" : "Collecting supplies"
        : confirmed
          ? "Source acknowledged"
          : "Awaiting source acknowledgement",
    confirmationText: taskComplete
      ? kind === "repair"
        ? "The operational source confirms that the road repair is complete."
        : "The operational source confirms that the field visit is complete. Check the related investigation for its findings."
      : receipt
      ? received !== null
        ? `${received.toLocaleString("en-US")} ${unit ?? "(unit not recorded)"} received by the operational source.`
        : "A receipt has been recorded by the operational source."
      : arrived
        ? fieldTask
          ? "The vehicle has reached the worksite. Task completion is not yet confirmed."
          : "The vehicle has arrived. Receipt is still pending."
        : moving
          ? fieldTask
            ? "The operational source confirms that the team is travelling to the worksite. Arrival and task completion are still pending."
            : ["evacuation", "evacuate"].includes(kind)
              ? "The operational source confirms that the vehicle is transporting people to the receiving site. Arrival is still pending."
              : "The operational source confirms that the vehicle has departed with the assigned supplies. Arrival and receipt are still pending."
          : pickupMoving
            ? ["evacuation", "evacuate"].includes(kind)
              ? "The vehicle is travelling to collect people. Transport to the receiving site has not started yet."
              : "The vehicle is travelling to collect supplies. Delivery to the destination has not started yet."
        : fieldTask
          ? "The task has not yet reached confirmed completion."
          : "The operation has not yet reached confirmed receipt.",
    stages: [
      [
        "Authorized",
        Number.isFinite(times.authorized) || !!operation.authorizedBy,
      ],
      [
        "Accepted",
        confirmed &&
          [times.accepted, times.acknowledged, times.orderReceived].some(
            Number.isFinite,
          ),
      ],
      [
        "Preparing",
        confirmed &&
          [times.loading, times.prepared, times.reserved].some(Number.isFinite),
      ],
      ["In transit", deliveryDeparted],
      [fieldTask ? "At worksite" : "Arrived", arrived],
      ...(!fieldTask ? [["Received", receipt]] : []),
      [fieldTask ? "Completed" : "Service", confirmed && Number.isFinite(times.service)],
    ],
  };
}

/** Distinguish concurrent trips without exposing opaque operational identifiers. */
export function operationChoiceLabel(operation, context = {}) {
  const summary = operationSummary(operation, context), vehicle = find(context.vehicles, operation.vehicle),
    identity = vehicle ? vehicleDisplayIdentity(vehicle) : null,
    transport = identity?.plate || summary.vehicle;
  return [summary.title, summary.quantity != null ? `${summary.quantity.toLocaleString("en-US")}${summary.unit ? " " + summary.unit : ""}` : "", transport, humanLabel(operation.state)].filter(Boolean).join(" · ");
}

export function createOperationView({ escape: e, badge, action, number }) {
  const cargo = (summary) =>
    [
      summary.quantity !== null
        ? `${number(summary.quantity)} ${summary.unit ?? "(unit not recorded)"}`
        : "",
      summary.resourceName,
      summary.vehicle,
    ]
      .filter(Boolean)
      .join(" · ");
  function row(operation, context) {
    const summary = operationSummary(operation, context);
    return `<tr><td><strong>${e(summary.title)}</strong>${cargo(summary) ? `<small>${e(cargo(summary))}</small>` : ""}</td><td>${badge(operation.state)}${operation.requiresRepair ? " " + badge("requires_review") : ""}</td><td>${e(summary.author)}<small>${e(summary.owner)}</small></td><td>${e(summary.received !== null ? `${number(summary.received)} ${summary.unit ?? "(unit not recorded)"} received` : summary.confirmation)}</td><td>${action("Follow", "operation", operation.id)}</td></tr>`;
  }
  function detail(operation, context) {
    const summary = operationSummary(operation, context),
      last = Math.max(
        -1,
        ...summary.stages.map(([, reached], index) => (reached ? index : -1)),
      );
    return `<div class="cardheader"><h2>${e(summary.title)}</h2>${badge(operation.state)}</div>${cargo(summary) ? `<p class="sub">${e(cargo(summary))}</p>` : ""}<div class="stepper">${summary.stages.map(([label], index) => `<div class="step ${index <= last ? "done" : ""} ${index === last ? "active" : ""}">${e(label)}</div>`).join("")}</div><div class="detailgrid"><div class="decision"><span class="eyebrow">What is confirmed?</span><p>${e(summary.confirmationText)}</p></div><div class="decision"><span class="eyebrow">Responsible owner</span><p>${e(summary.author)}<br>${e(summary.owner)}</p></div></div>${operation.requiresRepair ? `<div class="warning" style="margin-top:20px">${e(operation.changedReason ?? "A dependency changed. Review the affected plan.")}</div>` : ""}<details class="collapse"><summary>Operational record & timestamps</summary><pre class="trace">${e(JSON.stringify(operation, null, 2))}</pre></details>`;
  }
  return { row, detail };
}
