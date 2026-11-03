import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { parseEcbXml } from "../shared/fx";

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** Fetches the ECB daily reference rates once per weekday. A failed or malformed fetch keeps yesterday's rates. */
export const refreshFxRates = onSchedule({ schedule: "30 16 * * 1-5", timeZone: "Europe/Berlin" }, async () => {
  try {
    const res = await fetch(ECB_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`ECB responded ${res.status}`);
    const fx = parseEcbXml(await res.text());
    if (!fx) throw new Error("ECB feed was not in the expected format");
    await getFirestore().doc("config/fx").set(fx);
  } catch (err) {
    logger.error("refreshFxRates failed, keeping previous rates", { err: String(err) });
  }
});
