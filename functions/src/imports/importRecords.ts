import { createHash } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { analyzeRows, importRecordsInput } from "../shared/importing";
import { requireMember } from "../workspaces/access";
import { confirmImport, releaseImport, reserveImport } from "../recommendations/usage";
import { ensureAccountForWorkspace } from "../accounts/account";
import { addNotification } from "../notify/inapp";

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

  const db = getFirestore();
  await requireMember(db, inp.workspaceId, uid, true);

  const jobRef = db.doc(`workspaces/${inp.workspaceId}/imports/${inp.requestId}`);
  const prior = await jobRef.get();
  if (prior.exists && !inp.dryRun) return { ...prior.data(), duplicateRequest: true };

  const biz = await db.doc(`workspaces/${inp.workspaceId}/businesses/${inp.businessId}`).get();
  if (!biz.exists) throw new HttpsError("not-found", "Business not found.");
  const b = biz.data()!;

  const batches = inp.batches && inp.batches.length > 0
    ? inp.batches
    : [{ collection: inp.collection, mapping: inp.mapping, rows: inp.rows }];

  const dates: string[] = [];
  const currencySet = new Set<string>();
  const defaultsAppliedSet = new Set<string>();
  const allRowErrors: { line: number; errors: string[] }[] = [];
  const batchSummaries: Record<string, { total: number; valid: number; invalid: number; imported: number }> = {};

  interface ItemToWrite {
    collection: string;
    id: string;
    line: number;
    record: Record<string, unknown>;
  }

  const toWrite: ItemToWrite[] = [];
  let totalReceived = 0;
  let totalValid = 0;
  let totalInvalid = 0;
  let totalDuplicatesInFile = 0;
  let totalDuplicatesSaved = 0;

  for (const batch of batches) {
    const a = analyzeRows(batch.collection, batch.rows, batch.mapping, {
      ...inp.options, defaults: { currency: b.currency, objective: b.objective },
    });

    totalReceived += a.total;
    totalValid += a.valid.length;
    totalInvalid += a.invalid.length;
    totalDuplicatesInFile += a.duplicatesInFile.length;
    a.defaultsApplied.forEach((d) => defaultsAppliedSet.add(d));

    a.invalid.forEach((r) => {
      if (allRowErrors.length < MAX_ERRORS_STORED) {
        allRowErrors.push({
          line: r.line,
          errors: r.errors.map((e) => `[${batch.collection}] ${e.field ?? ""} ${e.message}`.trim()),
        });
      }
    });

    // Check existing for this collection
    const colPath = `workspaces/${inp.workspaceId}/${batch.collection}`;
    const withIds = a.valid.map((v) => ({
      ...v, collection: batch.collection, id: "imp_" + createHash("sha256").update(`${batch.collection}|${inp.businessId}|${v.key}`).digest("hex").slice(0, 32),
    }));

    const existing = new Set<string>();
    for (let i = 0; i < withIds.length; i += 300) {
      const refs = withIds.slice(i, i + 300).map((v) => db.doc(`${colPath}/${v.id}`));
      (await db.getAll(...refs)).forEach((s) => { if (s.exists) existing.add(s.id); });
    }
    totalDuplicatesSaved += existing.size;

    const batchToWrite = withIds.filter((v) => !existing.has(v.id));
    toWrite.push(...batchToWrite);

    batchSummaries[batch.collection] = {
      total: a.total,
      valid: a.valid.length,
      invalid: a.invalid.length,
      imported: 0,
    };

    a.valid.forEach((v) => {
      const rec = v.record as Record<string, unknown>;
      const d = (rec.date || rec.startDate || rec.publishedAt || rec.effectiveDate) as string | undefined;
      if (d) dates.push(d);
      if (typeof rec.currency === "string" && rec.currency) currencySet.add(rec.currency);
    });
  }

  dates.sort();
  const dateRange = dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null;
  const currencies = Array.from(currencySet);

  const counts = {
    received: totalReceived, valid: totalValid, rejected: totalInvalid, invalid: totalInvalid,
    duplicate: totalDuplicatesInFile + totalDuplicatesSaved, duplicatesInFile: totalDuplicatesInFile,
    duplicatesSaved: totalDuplicatesSaved, toImport: toWrite.length, imported: 0,
  };
  const report = {
    counts, defaultsApplied: Array.from(defaultsAppliedSet), dateRange, currencies,
    rowErrors: allRowErrors,
    batchSummaries,
  };
  if (inp.dryRun) return { dryRun: true, ...report };

  const targetColl = batches.length === 1 ? batches[0].collection : "multi";

  if (toWrite.length === 0) {
    const status = totalInvalid > 0 ? "failed" : "completed";
    const job = { ...report, status, collection: targetColl, fileName: inp.fileName, createdBy: uid, createdAt: FieldValue.serverTimestamp() };
    await jobRef.set(job);
    if (status === "failed") {
      await addNotification(db, inp.workspaceId, {
        kind: "import_failed",
        title: "Import file has row errors",
        body: `File "${inp.fileName}" could not import records: ${totalInvalid} row(s) had formatting errors. Review errors and retry.`,
        priority: "normal",
      }, `imp_fail_${inp.requestId}`).catch(() => undefined);
    }
    return { ...report, status };
  }

  await ensureAccountForWorkspace(db, inp.workspaceId);
  const reservation = await reserveImport(db, inp.workspaceId, inp.requestId);
  if (!reservation.ok) {
    throw new HttpsError("resource-exhausted", "Import limit reached for this month.", { limit: reservation.limit, resetsOn: reservation.resetsOn });
  }

  try {
    for (let i = 0; i < toWrite.length; i += BATCH) {
      const batch = db.batch();
      for (const v of toWrite.slice(i, i + BATCH)) {
        batch.create(db.doc(`workspaces/${inp.workspaceId}/${v.collection}/${v.id}`), {
          ...v.record, workspaceId: inp.workspaceId, businessId: inp.businessId, createdBy: uid,
          createdAt: FieldValue.serverTimestamp(), provenance: "imported", importJobId: inp.requestId, sourceLine: v.line,
        });
        if (batchSummaries[v.collection]) {
          batchSummaries[v.collection].imported++;
        }
      }
      await batch.commit();
      counts.imported += Math.min(BATCH, toWrite.length - i);
    }
    const status = totalInvalid > 0 ? "partial" : "completed";
    await jobRef.set({
      ...report, counts, status, collection: targetColl, fileName: inp.fileName.slice(0, 200),
      createdBy: uid, createdAt: FieldValue.serverTimestamp(),
    });
    await confirmImport(db, inp.workspaceId, inp.requestId);

    if (status === "partial") {
      await addNotification(db, inp.workspaceId, {
        kind: "import_failed",
        title: "Import completed with row errors",
        body: `File "${inp.fileName}": ${counts.imported} records imported, but ${totalInvalid} row(s) had errors and were skipped.`,
        priority: "normal",
      }, `imp_part_${inp.requestId}`).catch(() => undefined);
    }
    return { ...report, counts, status };
  } catch (err) {
    logger.error("importRecords failed", { workspaceId: inp.workspaceId, requestId: inp.requestId, imported: counts.imported, err: String(err) });
    await releaseImport(db, inp.workspaceId, inp.requestId);
    await addNotification(db, inp.workspaceId, {
      kind: "import_failed",
      title: "Import interrupted",
      body: `File "${inp.fileName}" failed part-way through importing. Saved rows will be safely deduplicated on retry.`,
      priority: "high",
    }, `imp_err_${inp.requestId}`).catch(() => undefined);
    throw new HttpsError("internal", "Import failed part-way. Re-upload the same file: rows already saved are skipped as duplicates.");
  }
});
