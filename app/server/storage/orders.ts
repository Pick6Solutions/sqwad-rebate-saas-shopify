// app/server/storage/orders.ts
import type { DocumentReference } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firebase";
import { orderDocId } from "../shopify/ids";

export type OrderUpsert = {
  shopId: string;              // e.g., "store.myshopify.com"
  orderId: string | number;             // Shopify GID: "gid://shopify/Order/1234567890"
  gameId?: string | null;
  orderName?: string | null;
  customerId?: string | null;
  customerEmail?: string | null;
  currency?: string | null;
  subtotal?: number | null;
  total?: number | null;
  financialStatus?: string | null;
  cancelledAt?: string | null;
  predictionId?: string | null;
  userId?: string | null;
  optIn?: boolean | null;
  orderGid?: string | null;
  orderNumericId?: string | null;

  // registration flags
  eligiblePending?: boolean | null; // “should be registered once paid”
  registered?: boolean | null;      // actually registered (after payment)
  credited?: boolean | null;        // if you’re issuing credit/codes
  createdAt?: string | null;        // ISO
  updatedAtISO?: string | null;     // optional override
  excluded?: boolean | null;
};

export type OrderRecord = Omit<OrderUpsert, "orderId"> & {
  orderId: string;
  creditError?: string | null;
};

function orderRefForGame(shopId: string, gameId: string, orderIdOrGid: string | number) {
  const docId = orderDocId(orderIdOrGid);
  return db.doc(`shops/${shopId}/games/${gameId}/orders/${docId}`);
}

async function resolveOrderRef(
  shopId: string,
  orderIdOrGid: string | number,
  gameId?: string | null
): Promise<{ ref: DocumentReference; gameId: string | null } | null> {
  if (gameId) {
    const ref = orderRefForGame(shopId, gameId, orderIdOrGid);
    const snap = await ref.get();
    if (snap.exists) return { ref, gameId };
  }

  const numericId = orderDocId(orderIdOrGid);
  const existing = await db
    .collectionGroup("orders")
    .where("shopId", "==", shopId)
    .where("orderId", "==", numericId)
    .limit(1)
    .get();

  const match = existing.docs[0];
  if (match) {
    const matchGameId = orderGameIdFromPath(match.ref.path) ?? (match.data() as OrderRecord)?.gameId ?? null;
    return { ref: match.ref, gameId: matchGameId };
  }

  return null;
}

export function orderGameIdFromPath(path: string): string | null {
  const segments = path.split("/");
  const gamesIndex = segments.indexOf("games");
  if (gamesIndex >= 0 && segments.length > gamesIndex + 1) {
    return segments[gamesIndex + 1];
  }
  return null;
}

export async function getOrderRecord(
  shopId: string,
  orderIdOrGid: string | number
): Promise<OrderRecord | null> {
  const resolved = await resolveOrderRef(shopId, orderIdOrGid);
  if (!resolved) return null;
  const snap = await resolved.ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as OrderRecord | undefined;
  if (!data) return null;

  const docId = orderDocId(orderIdOrGid);
  return {
    ...data,
    gameId: data.gameId ?? resolved.gameId ?? null,
    shopId: data.shopId ?? shopId,
    orderId: data.orderId ?? docId,
  };
}

export async function upsertOrder(input: OrderUpsert) {
  const { shopId, orderId, gameId, ...rest } = input;

  if (!gameId) {
    const existing = await resolveOrderRef(shopId, orderId);
    if (!existing) {
      console.warn(`[orders] Unable to locate existing order ${orderId} for shop ${shopId}; skipping update`);
      return;
    }
    await existing.ref.set(buildPayload(shopId, orderId, rest), { merge: true });
    return;
  }

  const ref = orderRefForGame(shopId, gameId, orderId);
  const payload = buildPayload(shopId, orderId, { ...rest, gameId });
  await ref.set(payload, { merge: true });
}

function buildPayload(
  shopId: string,
  orderId: string | number,
  rest: Omit<OrderUpsert, "shopId" | "orderId">
) {
  const nowIso = new Date().toISOString();
  const s = String(orderId);
  const isGid = s.startsWith("gid://");
  const numericId = isGid ? s.split("/").pop()! : s;
  const gid = isGid ? s : `gid://shopify/Order/${numericId}`;

  const payload: Record<string, unknown> = {
    ...rest,
    shopId,
    orderId: numericId,
    orderGid: rest.orderGid ?? gid,
    orderNumericId: rest.orderNumericId ?? numericId,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtISO: rest.updatedAtISO ?? nowIso,
  };

  if (rest.createdAt !== undefined) {
    payload.createdAt = rest.createdAt;
  }

  const data = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
  return data;
}

export async function markRegistered(
  shopId: string,
  orderId: string,
  registered: boolean,
  opts?: { clearPending?: boolean; gameId?: string | null }
) {
  const clearPending = opts?.clearPending ?? !registered;
  const update: Record<string, unknown> = {
    registered,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtISO: new Date().toISOString(),
  };

  if (clearPending) {
    update.eligiblePending = false;
  }

  const resolved = await resolveOrderRef(shopId, orderId, opts?.gameId ?? null);
  if (!resolved) return;
  await resolved.ref.set(update, { merge: true });
}
