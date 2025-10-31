// app/server/storage/orders.ts
import { db } from "../firebase";
import { FieldValue } from "firebase-admin/firestore";
import {orderDocId} from "../shopify/ids";

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

  // registration flags
  eligiblePending?: boolean | null; // “should be registered once paid”
  registered?: boolean | null;      // actually registered (after payment)
  credited?: boolean | null;        // if you’re issuing credit/codes
  createdAt?: string | null;        // ISO
  updatedAtISO?: string | null;     // optional override
};

function key(shopId: string, orderIdOrGid: string) {
  const docId = orderDocId(orderIdOrGid);
  return db.doc(`shops/${shopId}/orders/${docId}`);
}

export async function upsertOrder(input: OrderUpsert) {
  const { shopId, orderId, ...rest } = input;
  const now = new Date().toISOString();
  const s = String(orderId);
  const isGid = s.startsWith("gid://");
  const numericId = isGid ? s.split("/").pop()! : s;
  const gid = isGid ? s : `gid://shopify/Order/${numericId}`;
  await key(shopId, orderId).set(
    {
      ...rest,
      shopId,
      orderId: numericId,
      orderGid: rest.orderGid ?? gid,
      orderNumericId: rest.orderNumericId ?? numericId,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtISO: rest.updatedAtISO ?? now,
      // don’t set createdAt repeatedly—only once
      createdAt: rest.createdAt ?? FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function markRegistered(shopId: string, orderId: string, registered: boolean) {
  await key(shopId, orderId).set(
    {
      registered,
      eligiblePending: false,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtISO: new Date().toISOString(),
    },
    { merge: true }
  );
}
