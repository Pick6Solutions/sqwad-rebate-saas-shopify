import { db } from "../firebase";
import { orderGameIdFromPath, type OrderRecord } from "./orders";
import { orderDocId } from "../shopify/ids";

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
  const ordersCollection = db.collectionGroup("orders");
  for (let i = 0; i < predictionIds.length; i += 10) {
    const chunk = predictionIds.slice(i, i + 10);
    const q = ordersCollection
      .where("shopId", "==", shopId)
      .where("predictionId", "in", chunk)
      .where("eligiblePending", "==", true)
      .where("credited", "==", false);
    const snap = await q.get();
    for (const doc of snap.docs) {
      const data = doc.data() as OrderRecord;
      const inferredGameId = data.gameId ?? orderGameIdFromPath(doc.ref.path);
      out.push({ id: doc.id, ...data, gameId: inferredGameId ?? null });
    }
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
  const orderIdPart = orderDocId(order.orderId);
  if (!order.gameId) {
    throw new Error(`Cannot mark credit for order ${order.orderId} without gameId`);
  }
  const orderRef = db.doc(`shops/${order.shopId}/games/${order.gameId}/orders/${orderIdPart}`);
  const creditRef = db.collection("credits").doc(creditId);

  await db.runTransaction(async trx => {
    const [creditSnap] = await Promise.all([trx.get(creditRef)]);
    if (creditSnap.exists) return; // idempotent

    if (updates.failed) {
      const failurePatch = { creditError: updates.creditError ?? "unknown" };
      trx.set(orderRef, failurePatch, { merge: true });
      trx.set(creditRef, {
        creditId, shopId: order.shopId, orderId: order.orderId,
        predictionId: order.predictionId ?? null, userId: order.userId,
        status: "failed", error: updates.creditError ?? "unknown",
        mode: updates.mode ?? null, createdAt: new Date().toISOString()
      }, { merge: true });
      return;
    }

    trx.set(creditRef, {
      creditId, shopId: order.shopId, orderId: order.orderId,
      predictionId: order.predictionId ?? null, userId: order.userId,
      amount: updates.amount ?? undefined, currency: updates.currency ?? order.currency,
      mode: updates.mode ?? null, giftCardId: updates.giftCardId ?? null,
      storeCreditTxnId: updates.storeCreditTxnId ?? null,
      status: "issued", issuedAt: new Date().toISOString(), idempotencyKey: creditId
    }, { merge: true });

    const successPatch = { credited: true, eligiblePending: false, creditError: null };
    trx.set(orderRef, successPatch, { merge: true });
  });
}

export async function creditRecordExists(creditId: string): Promise<boolean> {
  if (!creditId) return false;
  const ref = db.collection("credits").doc(creditId);
  const snap = await ref.get();
  return snap.exists;
}
