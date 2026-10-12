import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { hash, uid } from "./store.mjs";
import { check, role } from "./errors.mjs";
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
    const metadata = await this.store.get(org, "media", id);
    return {
      metadata,
      bytes: await readFile(
        path.resolve(this.config.evidenceDir, org, metadata.contentHash),
      ),
    };
  }
}
