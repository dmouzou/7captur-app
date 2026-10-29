import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Email outbox, compatible with the Firebase "Trigger Email from Firestore" extension
 * (collection "mail"). The extension sends, retries and writes delivery status back onto the doc,
 * which doubles as the delivery log. The doc id is the idempotency key: create() fails if it exists,
 * so a retried job can never send the same email twice.
 */
export async function enqueueMail(
  db: Firestore, id: string, mail: { to: string; subject: string; text: string; html: string; meta: Record<string, string> },
): Promise<boolean> {
  try {
    await db.collection("mail").doc(id).create({
      to: mail.to, message: { subject: mail.subject, text: mail.text, html: mail.html }, meta: mail.meta, queuedAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (e) {
    if ((e as { code?: number }).code === 6) return false; // ALREADY_EXISTS
    throw e;
  }
}

export const APP_URL = process.env.APP_URL ?? "https://app.7captur.com";

/** No business values in subject or body: link to the authenticated app instead. */
export function weeklyEmail() {
  const link = `${APP_URL}/`;
  return {
    subject: "Your 7Captur weekly summary is ready",
    text: `Your weekly summary is ready. Sign in to read it:\n${link}\n\nYou can turn these emails off in Settings.`,
    html: `<p>Your weekly summary is ready.</p><p><a href="${link}">Open 7Captur</a></p><p style="color:#666">You can turn these emails off in Settings.</p>`,
  };
}
