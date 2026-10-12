import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { decode } from "./media.mjs";
import { hash, uid } from "./store.mjs";
import { check, role } from "./errors.mjs";
import { publicText } from "./public-safety.mjs";

export class PublicEvidence {
  constructor(store, evidence, config, decoder = decode) {
    Object.assign(this, { store, evidence, config, decoder });
  }
  async approve(actor, input, key) {
    role(actor, ["publisher", "commander", "dispatcher"]);
    check(
      input.privacyReviewed === true &&
        typeof input.caption === "string" &&
        input.caption.trim().length >= 3 &&
        input.caption.length <= 500,
      "PUBLIC_PRIVACY_REVIEW",
      "Review the image for identifying people, names and sensitive details, then provide a public caption.",
    );
    publicText(input.caption);
    const original = await this.evidence.read(actor.org, input.mediaId);
    check(
      ["image/png", "image/jpeg"].includes(original.metadata.mime),
      "PUBLIC_IMAGE",
      "Public evidence accepts reviewed photo images only.",
    );
    const operation = await this.store.get(
      actor.org,
      "operation",
      input.operationId,
    );
    check(
      operation.confirmedBySource === true &&
        ["received", "completed", "service"].includes(operation.state),
      "PUBLIC_RECEIPT",
      "A public receipt photo must cite a source-confirmed operation.",
    );
    const temporary = path.join(
      this.config.evidenceDir,
      actor.org,
      uid("public-rendition"),
    );
    let rendition;
    try {
      rendition = await this.decoder(this.config, {
        mode: "public_image",
        path: path.join(
          this.config.evidenceDir,
          actor.org,
          original.metadata.contentHash,
        ),
        output: temporary,
      });
      check(
        rendition.metadataStripped === true &&
          rendition.width > 0 &&
          rendition.height > 0 &&
          rendition.width <= 1600 &&
          rendition.height <= 1600,
        "PUBLIC_RENDITION",
        "A bounded, metadata-free image rendition is required.",
      );
      const bytes = await readFile(temporary),
        publicHash = hash(bytes.toString("base64"));
      await writeFile(
        path.join(this.config.evidenceDir, actor.org, publicHash),
        bytes,
      );
      return this.store.command(actor.org, key, input, async (tx) => {
        const latest = await tx.get(actor.org, "operation", operation.id);
        check(
          latest.version === operation.version &&
            latest.confirmedBySource === true &&
            ["received", "completed", "service"].includes(latest.state),
          "PUBLIC_RECEIPT_CHANGED",
          "The receipt changed during image review. Review the latest operation.",
          409,
        );
        const id = uid("public-proof");
        const proof = await tx.put(
          actor.org,
          "public_evidence",
          id,
          {
            mediaId: input.mediaId,
            sourceVersion: original.metadata.version,
            originalHash: original.metadata.contentHash,
            publicHash,
            operationId: operation.id,
            operationVersion: operation.version,
            caption: input.caption,
            state: "approved",
            approvedBy: actor.id,
            approvedAt: Date.now(),
            metadataStripped: rendition.metadataStripped,
            dimensions: { width: rendition.width, height: rendition.height },
            privacyReview:
              "human; no automatic identity or face-detection guarantee",
          },
          0,
        );
        await tx.audit(actor.org, actor.id, "public_evidence.approved", id, {
          operationId: operation.id,
          originalHash: original.metadata.contentHash,
          publicHash,
        });
        return proof;
      });
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async publiclyVisible(org, id) {
    const p = await this.store.get(org, "public_evidence", id, false);
    if (!p || p.state !== "approved") return null;
    const visible = (
      await this.store.query(
        "SELECT id FROM entities WHERE org=$1 AND kind='publication' AND data->>'state'='published' AND data->'proofIds' @> $2::jsonb LIMIT 1",
        [org, JSON.stringify([id])],
      )
    ).rows[0];
    if (!visible) return null;
    return {
      mime: "image/png",
      bytes: await readFile(
        path.join(this.config.evidenceDir, org, p.publicHash),
      ),
    };
  }
}
