import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { hash, uid } from "./store.mjs";
import { check, role } from "./errors.mjs";
export function requireMediaBytes(metadata) {
  check(
    metadata &&
      /^[a-f0-9]{64}$/.test(metadata.contentHash ?? "") &&
      typeof metadata.mime === "string" &&
      Number.isSafeInteger(metadata.size) &&
      metadata.size > 0,
    "MEDIA_BYTES_UNAVAILABLE",
    "This source has no uploaded media bytes. Its description can be reviewed as a signal, but not as a viewed image, video or document.",
    404,
  );
  return metadata;
}
export class EvidenceStore {
  constructor(store, config) {
    Object.assign(this, { store, config });
  }
  async save(actor, { contentBase64, mime, title, source, observedAt }, key) {
    role(actor, ["field", "analyst", "commander", "dispatcher"]);
    check(
      [
        "image/png",
        "image/jpeg",
        "video/mp4",
        "audio/wav",
        "audio/mpeg",
        "application/pdf",
        "text/plain",
      ].includes(mime),
      "MEDIA_TYPE",
      "Unsupported evidence format.",
    );
    const bytes = Buffer.from(contentBase64, "base64");
    check(
      bytes.length > 0 && bytes.length <= 10000000,
      "MEDIA_SIZE",
      "Evidence must be between one byte and 10 MB.",
    );
    const digest = hash(bytes.toString("base64")),
      dir = path.resolve(this.config.evidenceDir, actor.org);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, digest), bytes);
    return this.store.command(
      actor.org,
      key,
      { digest, mime, title, source, observedAt },
      async (tx) => {
        const id = uid("media");
        const result = await tx.put(
          actor.org,
          "media",
          id,
          {
            mime,
            title,
            source,
            observedAt,
            size: bytes.length,
            contentHash: digest,
            state: "unverified",
            receivedAt: Date.now(),
            visibility: "organization",
            uploadedBy: actor.id,
            moderationRequired: actor.id === "community-public",
          },
          0,
        );
        await tx.audit(actor.org, actor.id, "evidence.uploaded", id, {
          mime,
          contentHash: digest,
          size: bytes.length,
        });
        return result;
      },
    );
  }
  async read(org, id) {
    const metadata = requireMediaBytes(
      await this.store.get(org, "media", id, false),
    );
    const bytes = await readFile(
      path.resolve(this.config.evidenceDir, org, metadata.contentHash),
    ).catch((error) => {
      check(
        error.code !== "ENOENT",
        "MEDIA_BYTES_UNAVAILABLE",
        "The original media file is unavailable. Preserve its reference and request the source again.",
        404,
      );
      throw error;
    });
    check(
      bytes.length === metadata.size &&
        hash(bytes.toString("base64")) === metadata.contentHash,
      "MEDIA_INTEGRITY",
      "This media file does not match its stored original. Do not interpret or publish it.",
      409,
    );
    return { metadata, bytes };
  }
}
