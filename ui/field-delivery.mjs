const MAX_ATTACHMENT_BYTES = 2_000_000;
const KINDS = new Set([
  "need",
  "receipt",
  "road",
  "facility",
  "correction",
  "voice",
]);
const MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "audio/wav",
  "audio/mpeg",
]);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

/** Validate the original file before uploading; previews are never evidence. */
export function validateFieldAttachment(attachment) {
  requireValue(
    attachment && MIME_TYPES.has(attachment.mime),
    "Choose a PNG, JPEG, WAV or MP3 attachment.",
  );
  const encoded = attachment.contentBase64;
  requireValue(
    typeof encoded === "string" &&
      encoded.length > 0 &&
      encoded.length <= Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4,
    "The attachment must be between one byte and 2 MB.",
  );
  requireValue(
    encoded.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded),
    "The attachment could not be read. Please attach the original file again.",
  );
  let bytes;
  try {
    bytes = atob(encoded);
  } catch {
    throw new Error(
      "The attachment could not be read. Please attach the original file again.",
    );
  }
  requireValue(
    bytes.length > 0 && bytes.length <= MAX_ATTACHMENT_BYTES,
    "The attachment must be between one byte and 2 MB.",
  );
  const byte = (index) => bytes.charCodeAt(index);
  const matches = {
    "image/png": () => bytes.startsWith("\x89PNG\r\n\x1a\n"),
    "image/jpeg": () =>
      byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff,
    "audio/wav": () =>
      bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WAVE",
    "audio/mpeg": () =>
      bytes.startsWith("ID3") ||
      (byte(0) === 0xff && (byte(1) & 0xe0) === 0xe0),
  };
  requireValue(
    matches[attachment.mime](),
    "The attachment does not match its file format. Please choose the original PNG, JPEG, WAV or MP3 file.",
  );
  return attachment;
}

function reportPayload(item, attachmentId) {
  const { clientId, text, location, observedAt, quantity, unit } = item;
  const kind = item.kind ?? "need";
  requireValue(
    typeof clientId === "string" &&
      clientId.length >= 3 &&
      clientId.length <= 180,
    "This saved report has an invalid tracking reference.",
  );
  requireValue(
    typeof text === "string" && text.trim().length > 0 && text.length <= 6000,
    "Describe what you observed in up to 6,000 characters.",
  );
  requireValue(KINDS.has(kind), "Choose a supported report type.");
  requireValue(
    location === undefined ||
      (typeof location === "string" && location.length <= 200),
    "Use a location of up to 200 characters.",
  );
  requireValue(
    Number.isSafeInteger(observedAt) && observedAt >= 0,
    "This saved report needs a valid observation time.",
  );
  requireValue(
    item.references === undefined ||
      (Array.isArray(item.references) &&
        item.references.every(
          (ref) => typeof ref === "string" && ref.length > 0,
        )),
    "This report has an invalid evidence reference.",
  );
  requireValue(
    attachmentId === undefined ||
      (typeof attachmentId === "string" &&
        attachmentId.length > 0 &&
        attachmentId.length <= 180),
    "This saved attachment has an invalid reference.",
  );
  const references = [
    ...new Set([
      ...(item.references ?? []),
      ...(attachmentId ? [attachmentId] : []),
    ]),
  ];
  requireValue(
    references.length <= 20,
    "A report can include up to 20 distinct evidence references, including its attachment.",
  );
  requireValue(
    quantity === undefined ||
      (typeof quantity === "number" &&
        Number.isFinite(quantity) &&
        quantity >= 0),
    "Use a valid reported quantity.",
  );
  requireValue(
    unit === undefined || (typeof unit === "string" && unit.length <= 30),
    "Use a unit of up to 30 characters.",
  );
  // Explicit projection keeps local queue metadata and file bytes out of the
  // strict report contract and its smaller 1 MB HTTP endpoint.
  const payload = {
    clientId,
    text,
    kind,
    observedAt,
    references,
    ...(location !== undefined ? { location } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(unit !== undefined ? { unit } : {}),
  };
  requireValue(
    new TextEncoder().encode(JSON.stringify(payload)).length <= 1_000_000,
    "This report is too large to send. Keep its description and references shorter.",
  );
  return payload;
}

async function uploadKey(clientId) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId)),
  );
  return (
    "field-media-" +
    Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

/** Deliver one queued observation. The caller deletes it only after this ACK. */
export async function deliverFieldReport(item, { api, persist, actor } = {}) {
  requireValue(
    item && typeof item === "object" && item.queueKind !== "task",
    "Only field observations can be sent through this form.",
  );
  requireValue(
    typeof api === "function",
    "The report connection is unavailable.",
  );
  if (actor)
    requireValue(
      item.queueOrg === actor.org && item.queueActor === actor.id,
      "Sign in to the original workspace and account before sending this saved report.",
    );
  let payload = reportPayload(item, item.attachmentId);
  if (item.attachment && !item.attachmentId) {
    requireValue(
      typeof persist === "function",
      "The offline queue is unavailable. Your report has not been sent.",
    );
    requireValue(
      typeof item.queueActor === "string" && item.queueActor.length > 0,
      "Sign in to the original account before sending this attachment.",
    );
    validateFieldAttachment(item.attachment);
    // Reserve the maximum ID length before creating an uploaded record. This
    // also checks the combined body/reference limits without orphaning media.
    requireValue(
      payload.references.length < 20,
      "A report can include up to 20 distinct evidence references, including its attachment.",
    );
    reportPayload(item, "x".repeat(180));
    const media = await api("/api/media/upload", {
      mime: item.attachment.mime,
      contentBase64: item.attachment.contentBase64,
      title: (
        "Field attachment" + (item.location ? " · " + item.location : "")
      ).slice(0, 150),
      source: "Authenticated field report · " + item.queueActor.slice(0, 160),
      observedAt: item.observedAt,
      idempotencyKey: await uploadKey(item.clientId),
    });
    requireValue(
      media &&
        typeof media.id === "string" &&
        media.id.length > 0 &&
        media.id.length <= 180,
      "The attachment upload was not acknowledged. Your report remains saved on this device.",
    );
    // Durable ACK first. If persisting fails, retrying the same upload key
    // recovers its original media record without submitting an untracked report.
    await persist({ ...item, attachmentId: media.id });
    // The caller's error handler may re-save this same item after a failed
    // report request. Keep the acknowledged attachment ID in that copy, too.
    item.attachmentId = media.id;
    payload = reportPayload(item, media.id);
  }
  const report = await api("/api/report", payload);
  requireValue(
    report && report.id === item.clientId && report.state === "received",
    "The report was not acknowledged. It remains saved on this device for retry.",
  );
  return report;
}
