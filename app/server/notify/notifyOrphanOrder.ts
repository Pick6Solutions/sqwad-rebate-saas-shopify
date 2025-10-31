// app/server/notify/notifyOrphanOrder.ts
import { db } from "../firebase";
import { sendMailgunEmail } from "./mailgun";

type OrphanRecord = {
  shopId: string;
  orderId: string;
  topics: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  expireAt: Date; // enable TTL on this field
};

export async function notifyOrphanOrderOnce(opts: {
  shopId: string;
  topic: string;              // e.g., "orders/create"
  orderId: string | number;   // raw from payload (we’ll String it)
  webhookId?: string | null;  // optional, for reference
}) {
  const { shopId, topic } = opts;
  const orderId = String(opts.orderId);
  const docId = `${shopId}:${orderId}`; // <-- aggregation key
  const ref = db.collection("alerts_orphanedOrders").doc(docId);

  const now = new Date();
  const expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  let isFirst = false;

  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) {
      isFirst = true;
      const data: OrphanRecord = {
        shopId,
        orderId,
        topics: [topic],
        firstSeenAt: now,
        lastSeenAt: now,
        expireAt,
      };
      t.set(ref, data);
    } else {
      // update topics set + lastSeen
      const curr = snap.data() as OrphanRecord;
      const topics = new Set(curr.topics || []);
      topics.add(topic);
      t.set(
        ref,
        {
          topics: Array.from(topics),
          lastSeenAt: now,
          // keep previous firstSeenAt, but refresh TTL
          expireAt,
        },
        { merge: true }
      );
    }
  });

  // Email only on first sighting of this (shop, order)
  if (isFirst) {
    const toList = (process.env.MAILGUN_TO || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!toList.length) return;

    const subject = `⚠️ Orphaned Shopify order: ${orderId} — ${shopId}`;
    const lines = [
      `Shop: ${shopId}`,
      `Order ID: ${orderId}`,
      `First Topic: ${topic}`,
      opts.webhookId ? `Webhook ID: ${opts.webhookId}` : null,
      `First Seen: ${now.toISOString()}`,
      "",
      "This shop is not onboarded/active (shops/{shopId}).",
      "We aggregated all order webhooks for this order under one record.",
    ].filter(Boolean);

    await sendMailgunEmail({
      to: toList,
      subject,
      text: lines.join("\n"),
    });
  }
}
