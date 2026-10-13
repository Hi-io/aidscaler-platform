import { check } from "./errors.mjs";

// Public unit conventions shared with the source. They are transport bounds,
// not observations of a particular vehicle or private stock.
const profiles = Object.freeze({
  water: { massKgPerUnit: 1, volumeM3PerUnit: 0.001, seatsPerUnit: 0 },
  food: { massKgPerUnit: 1, volumeM3PerUnit: 0.001, seatsPerUnit: 0 },
  blankets: { massKgPerUnit: 1, volumeM3PerUnit: 0.001, seatsPerUnit: 0 },
  sanitation: { massKgPerUnit: 1, volumeM3PerUnit: 0.001, seatsPerUnit: 0 },
  fuel: { massKgPerUnit: 1, volumeM3PerUnit: 0.001, seatsPerUnit: 0 },
  rescue: { massKgPerUnit: 1, volumeM3PerUnit: 0.001, seatsPerUnit: 0 },
  energy: { massKgPerUnit: 150, volumeM3PerUnit: 0.2, seatsPerUnit: 0 },
  staff: { massKgPerUnit: 75, volumeM3PerUnit: 0.075, seatsPerUnit: 1 },
});
const finite = value => Number.isFinite(value) && value >= 0;

export function receivedCargoProfile(resource, executionPolicy = null) {
  const observed = resource?.sourceSnapshot ?? resource,
    minimum = profiles[observed?.type],
    profile = observed?.transport ?? executionPolicy?.cargo?.types?.[observed?.type] ?? minimum;
  if (!profile || !Number.isFinite(profile.massKgPerUnit) || profile.massKgPerUnit <= 0 ||
      !Number.isFinite(profile.volumeM3PerUnit) || profile.volumeM3PerUnit <= 0 ||
      !Number.isSafeInteger(profile.seatsPerUnit) || profile.seatsPerUnit < 0 ||
      (minimum && (profile.massKgPerUnit < minimum.massKgPerUnit ||
        profile.volumeM3PerUnit < minimum.volumeM3PerUnit || profile.seatsPerUnit < minimum.seatsPerUnit))) return null;
  return { massKgPerUnit: profile.massKgPerUnit,
    volumeM3PerUnit: profile.volumeM3PerUnit, seatsPerUnit: profile.seatsPerUnit };
}

export function receivedCargoCapacity(vehicle, resource, executionPolicy = null) {
  const profile = receivedCargoProfile(resource, executionPolicy);
  if (!profile || !finite(vehicle?.capacity)) return 0;
  const bound = (value, perUnit) => value === undefined ? Infinity : finite(value) ? value / perUnit : 0;
  return Math.max(0, Math.floor(Math.min(vehicle.capacity,
    bound(vehicle.maxCargoKg, profile.massKgPerUnit),
    bound(vehicle.volumeM3, profile.volumeM3PerUnit),
    profile.seatsPerUnit ? (finite(vehicle.seats) ? vehicle.seats / profile.seatsPerUnit : 0) : Infinity)));
}

export function assertReceivedCargoCapacity(vehicle, resource, quantity, executionPolicy = null) {
  const profile = receivedCargoProfile(resource, executionPolicy);
  check(profile, "CARGO_PROFILE", "Receive a valid transport unit profile before reviewing this cargo.", 409);
  check(Number.isSafeInteger(quantity) && quantity > 0, "QUANTITY", "Cargo quantity must be a positive integer.");
  check(finite(vehicle?.capacity) && quantity <= vehicle.capacity, "VEHICLE_CAPACITY", "Vehicle unit capacity is insufficient.");
  check(vehicle.maxCargoKg === undefined || finite(vehicle.maxCargoKg) && quantity * profile.massKgPerUnit <= vehicle.maxCargoKg,
    "CARGO_WEIGHT", "The received vehicle cannot carry this cargo mass.");
  check(vehicle.volumeM3 === undefined || finite(vehicle.volumeM3) && quantity * profile.volumeM3PerUnit <= vehicle.volumeM3,
    "CARGO_VOLUME", "The received vehicle cannot carry this cargo volume.");
  check(!profile.seatsPerUnit || finite(vehicle.seats) && quantity * profile.seatsPerUnit <= vehicle.seats,
    "SEATS", "Not enough received passenger seats for the staff or passengers.");
  return profile;
}

// Cabin passengers and a working field crew occupy seats. The source's cargo
// hold limits are not an unreceived global cabin payload/volume contract.
export function assertReceivedPassengerCapacity(vehicle, quantity) {
  check(Number.isSafeInteger(quantity) && quantity > 0, "QUANTITY", "Passenger quantity must be a positive integer.");
  check(finite(vehicle?.seats) && quantity <= vehicle.seats,
    "SEATS", "Not enough received passenger seats for this crew or evacuation.");
  return profiles.staff;
}
