// A shared availability flag does not disclose a driver's identity or assert
// presence when that operational observation has not been received.
export function driverAvailabilityBadge(vehicle) {
  const [state, label] =
    vehicle?.driverAvailable === false
      ? ["requires_review", "No driver available"]
      : vehicle?.driverAvailable === true
        ? ["connected", "Driver available"]
        : ["unknown", "Driver availability unknown"];
  return `<span class="badge ${state}">${label}</span>`;
}
