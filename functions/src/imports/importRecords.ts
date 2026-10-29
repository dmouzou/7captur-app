import { createHash } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { SCREENSHOT_LIMITS, analyzeRows, importRecordsInput } from "../shared/importing";
import { requireMember } from "../workspaces/access";
import { confirmImport, releaseImport, reserveImport } from "../recommendations/usage";

const MAX_ERRORS_STORED = 100;
const BATCH = 400;

/**
 * CSV import commit. The browser parses and previews; this function re-runs the SAME
 * normalization (shared/importing.ts) so the server never trusts client validation.
 * Pipeline: authorize -> analyze -> duplicate check (in-file and already saved) -> quota ->
 * batch persist -> job report. Deterministic doc ids make retries and re-uploads safe.
 * dryRun returns the counts without writing or using quota.
 */
export const importRecords = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const parsed = importRecordsInput.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid import request.");
  const inp = parsed.data;
  const isShot = inp.source === "screenshot";
  if (isShot) {
    // AC-04: screenshot values become evidence only after the customer reviewed them.
    if (inp.reviewConfirmed !== true) throw new HttpsError("failed-precondition", "Review and confirm the extracted values first.");
    if (inp.rows.length > SCREENSHOT_LIMITS.maxRows) throw new HttpsError("invalid-argument", "Too many rows for a screenshot import.");
    if (!inp.uploadPath?.startsWith(`workspaces/${inp.workspaceId}/uploads/`) || inp.uploadPath.includes("..")) {
      throw new HttpsError("invalid-argument", "Missing or invalid upload reference.");
    }
  }

  const db = getFirestore();
  await requireMember(db, inp.workspaceId, uid, true);

  const jobRef = db.doc(`workspaces/${inp.workspaceId}/imports/${inp.requestId}`);
  const prior = await jobRef.get();
  if (prior.exists && !inp.dryRun) return { ...prior.data(), duplicateRequest: true };

  const biz = await db.doc(`workspaces/${inp.workspaceId}/businesses/${inp.businessId}`).get();
  if (!biz.exists) throw new HttpsError("not-found", "Business not found.");
  const b = biz.data()!;

  const a = analyzeRows(inp.collection, inp.rows, inp.mapping, {
    ...inp.options, defaults: { currency: b.currency, objective: b.objective },
  });

  // Duplicate check against records already saved (same business, same collection).
  const colPath = `workspaces/${inp.workspaceId}/${inp.collection}`;
  const withIds = a.valid.map((v) => ({
    ...v, id: "imp_" + createHash("sha256").update(`${inp.collection}|${inp.businessId}|${v.key}`).digest("hex").slice(0, 32),
  }));
  const existing = new Set<string>();
  for (let i = 0; i < withIds.length; i += 300) {
    const refs = withIds.slice(i, i + 300).map((v) => db.doc(`${colPath}/${v.id}`));
    (await db.getAll(...refs)).forEach((s) => { if (s.exists) existing.add(s.id); });
  }
  const toWrite = withIds.filter((v) => !existing.has(v.id));

  const counts = {
    received: a.total, valid: a.valid.length, invalid: a.invalid.length,
    duplicatesInFile: a.duplicatesInFile.length, duplicatesSaved: existing.size, toImport: toWrite.length, imported: 0,
  };
  const report = {
    counts, defaultsApplied: a.defaultsApplied,
    rowErrors: a.invalid.slice(0, MAX_ERRORS_STORED).map((r) => ({ line: r.line, errors: r.errors.map((e) => `${e.field ?? ""} ${e.message}`.trim()) })),
  };
  if (inp.dryRun) return { dryRun: true, ...report };

  if (toWrite.length === 0) {
    const status = a.invalid.length > 0 ? "failed" : "completed";
    const job = { ...report, status, collection: inp.collection, fileName: inp.fileName, createdBy: uid, createdAt: FieldValue.serverTimestamp() };
    await jobRef.set(job);
    return { ...report, status };
  }

  const reservation = await reserveImport(db, inp.workspaceId, inp.requestId);
  if (!reservation.ok) {
    throw new HttpsError("resource-exhausted", "Import limit reached for this month.", { limit: reservation.limit, resetsOn: reservation.resetsOn });
  }

  try {
    for (let i = 0; i < toWrite.length; i += BATCH) {
      const batch = db.batch();
      for (const v of toWrite.slice(i, i + BATCH)) {
        batch.create(db.doc(`${colPath}/${v.id}`), {
          ...v.record, workspaceId: inp.workspaceId, businessId: inp.businessId, createdBy: uid,
          createdAt: FieldValue.serverTimestamp(), provenance: isShot ? "screenshot_extracted" : "imported", importJobId: inp.requestId, sourceLine: v.line,
          ...(isShot ? { reviewedBy: uid } : {}),
        });
      }
      await batch.commit();
      counts.imported += Math.min(BATCH, toWrite.length - i);
    }
    const status = a.invalid.length > 0 ? "partial" : "completed";
    await jobRef.set({
      ...report, counts, status, collection: inp.collection, fileName: inp.fileName.slice(0, 200),
      createdBy: uid, createdAt: FieldValue.serverTimestamp(),
    });
    await confirmImport(db, inp.workspaceId, inp.requestId);
    if (isShot) await getStorage().bucket().file(inp.uploadPath!).delete({ ignoreNotFound: true }).catch(() => undefined);
    return { ...report, counts, status };
  } catch (err) {
    logger.error("importRecords failed", { workspaceId: inp.workspaceId, requestId: inp.requestId, imported: counts.imported, err: String(err) });
    await releaseImport(db, inp.workspaceId, inp.requestId);
    throw new HttpsError("internal", "Import failed part-way. Re-upload the same file: rows already saved are skipped as duplicates.");
  }
});
