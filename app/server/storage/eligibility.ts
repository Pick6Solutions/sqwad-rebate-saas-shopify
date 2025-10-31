import { db } from "../firebase";
import type { OrderRecord } from "./orders";

/** Winners list for an event */
export async function getCorrectPredictions(eventId: string): Promise<string[]> {
  const snap = await db.collection("predictions")
    .where("eventId", "==", eventId)
    .where("status", "==", "correct")
    .get();
  return snap.docs.map(d => d.id);
}

/** Firestore 'in' max 10 — chunk it. */
export async function findEligibleOrders(
  shopId: string,
  predictionIds: string[]
): Promise<Array<OrderRecord & { id: string }>> {
  const out: Array<OrderRecord & { id: string }> = [];
  for (let i = 0; i < predictionIds.length; i += 10) {
    const chunk = predictionIds.slice(i, i + 10);
    const q = db.collection("orders")
      .where("shopId", "==", shopId)
      .where("predictionId", "in", chunk)
      .where("eligiblePending", "==", true)
      .where("credited", "==", false);
    const snap = await q.get();
    for (const doc of snap.docs) out.push({ id: doc.id, ...(doc.data() as OrderRecord) });
  }
  return out;
}

/** Exactly-once write of credit record + flip order flags */
export async function markCredited(
  order: OrderRecord & { id?: string },
  updates: {
    mode?: "store_credit" | "gift_card";
    idempotencyKey?: string;
    giftCardId?: string;
    storeCreditTxnId?: string;
    failed?: boolean;
    creditError?: string;
    amount?: number;
    currency?: string;
  }
) {
  const creditId = updates.idempotencyKey ?? `cred_${order.shopId}_${order.orderId}`;
  const orderRef = db.collection("orders").doc(`${order.shopId}_${order.orderId}`);
  const creditRef = db.collection("credits").doc(creditId);

  await db.runTransaction(async trx => {
    const [creditSnap] = await Promise.all([trx.get(creditRef)]);
    if (creditSnap.exists) return; // idempotent

    if (updates.failed) {
      trx.set(orderRef, { creditError: updates.creditError ?? "unknown" }, { merge: true });
      trx.set(creditRef, {
        creditId, shopId: order.shopId, orderId: order.orderId,
        predictionId: order.predictionId, userId: order.userId,
        status: "failed", error: updates.creditError ?? "unknown",
        mode: updates.mode ?? null, createdAt: new Date().toISOString()
      }, { merge: true });
      return;
    }

    trx.set(creditRef, {
      creditId, shopId: order.shopId, orderId: order.orderId,
      predictionId: order.predictionId, userId: order.userId,
      amount: updates.amount ?? undefined, currency: updates.currency ?? order.currency,
      mode: updates.mode ?? null, giftCardId: updates.giftCardId ?? null,
      storeCreditTxnId: updates.storeCreditTxnId ?? null,
      status: "issued", issuedAt: new Date().toISOString(), idempotencyKey: creditId
    }, { merge: true });

    trx.set(orderRef, { credited: true, eligiblePending: false, creditError: null }, { merge: true });
  });
}
