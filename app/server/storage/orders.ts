// app/server/storage/orders.ts
import { db } from "../firebase";
import { FieldValue } from "firebase-admin/firestore";
import { orderDocId } from "../shopify/ids";

export type OrderUpsert = {
  shopId: string;              // e.g., "store.myshopify.com"
  orderId: string | number;             // Shopify GID: "gid://shopify/Order/1234567890"
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
};

export type OrderRecord = Omit<OrderUpsert, "orderId"> & {
  orderId: string;
  creditError?: string | null;
};

function shopOrderRef(shopId: string, orderIdOrGid: string | number) {
  const docId = orderDocId(orderIdOrGid);
  return db.doc(`shops/${shopId}/orders/${docId}`);
}

export async function getOrderRecord(
  shopId: string,
  orderIdOrGid: string | number
): Promise<OrderRecord | null> {
  const docId = orderDocId(orderIdOrGid);
  const ref = shopOrderRef(shopId, orderIdOrGid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as OrderRecord | undefined;
  if (!data) return null;

  return {
    ...data,
    shopId: data.shopId ?? shopId,
    orderId: data.orderId ?? docId,
  };
}

export async function upsertOrder(input: OrderUpsert) {
  const { shopId, orderId, ...rest } = input;
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

  const ref = shopOrderRef(shopId, orderId);
  await ref.set(data, { merge: true });
}

export async function markRegistered(
  shopId: string,
  orderId: string,
  registered: boolean,
  opts?: { clearPending?: boolean }
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

  const ref = shopOrderRef(shopId, orderId);
  await ref.set(update, { merge: true });
}
