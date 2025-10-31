// app/routes/api.credit-winners.tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { makeAdminClient } from "../server/shopify/admin";
import {
  getCorrectPredictions,
  findEligibleOrders,
  markCredited,
} from "../server/storage/eligibility";

const API_VERSION = "2025-10";

const SC_CREDIT_MUT = `#graphql
mutation storeCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!, $notify: Boolean) {
  storeCreditAccountCredit(id: $id, creditInput: $creditInput, notify: $notify) {
    storeCreditAccountTransaction { id amount { amount currencyCode } }
    userErrors { field message }
  }
}`;

const GIFT_CARD_CREATE = `#graphql
mutation IssueSqwadGiftCard($input: GiftCardCreateInput!, $idemp: String!) {
  giftCardCreate(input: $input, idempotencyKey: $idemp) {
    giftCard { id codeMasked balance { amount currencyCode } }
    userErrors { field message }
  }
}`;

type BodyWinners = {
  // existing winners flow
  eventId: string;
  mode?: "store_credit" | "gift_card";
  basis?: "subtotal" | "total";
  cap?: number;
  minSpend?: number;
  waitHours?: number;
  notify?: boolean;        // NEW: email the customer when credit is issued
  expiresAt?: string;      // NEW: ISO date, optional store credit expiry
};

type BodyManual = {
  // manual selection from OrdersViewer
  orders: Array<{
    orderId: string;
    email: string;
    subtotal: number;
    currencyCode: string; // e.g., "USD"
  }>;
  cap?: number;
  minSpend?: number;
  notify?: boolean;       // send Shopify email notification
  expiresAt?: string;     // optional expiry
};

type Incoming = BodyWinners | BodyManual;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session!.shop;
  const admin = makeAdminClient(shop, session!.accessToken, API_VERSION);

  const body = (await request.json()) as Incoming;

  // ---- BRANCH 1: Manual selections (OrdersViewer -> POST /api/shops/:shopId/grant-credit) ----
  if ("orders" in body) {
    const cap = body.cap ?? undefined;
    const minSpend = body.minSpend ?? undefined;
    const notify = body.notify ?? true;
    const expiresAt = body.expiresAt;

    let processed = 0;
    const failures: Array<{ orderId: string; error: string }> = [];

    for (const o of body.orders) {
      const idemp = `cred_${shop}_${o.orderId}`;
      let amount = Number(o.subtotal || 0);
      if (minSpend && amount < minSpend) continue;
      if (cap && amount > cap) amount = cap;
      if (amount <= 0) continue;

      try {
        const customerId = await findOrCreateCustomerByEmail(admin, o.email);
        const txn = await creditCustomer(admin, customerId, amount, o.currencyCode, { notify, expiresAt });

        // If markCredited requires full order shape, either:
        //  (A) allow a minimal object (shown here), or
        //  (B) make a tiny overload: markCreditedById(shop, o.orderId, {...})
        await markCredited(
          { orderId: o.orderId, customerEmail: o.email, currency: o.currencyCode } as any,
          {
            mode: "store_credit",
            storeCreditTxnId: txn.id,
            idempotencyKey: idemp,
            amount,
            currency: o.currencyCode,
          }
        );
        processed++;
      } catch (e: any) {
        failures.push({ orderId: o.orderId, error: String(e?.message || e) });
        await markCredited({ orderId: o.orderId, customerEmail: o.email } as any, {
          failed: true,
          creditError: String(e?.message || e),
        });
      }
    }

    return Response.json({ ok: true, processed, failures });
  }

  // ---- BRANCH 2: Existing winners flow (eventId -> predictions -> eligible orders) ----
  const {
    mode = "store_credit",
    basis = "subtotal",
    cap,
    minSpend,
    waitHours,
    notify = true,
    expiresAt,
  } = body as BodyWinners;

  const predictionIds = await getCorrectPredictions((body as BodyWinners).eventId);
  if (!predictionIds.length) {
    return Response.json({ ok: true, credited: 0, reason: "no winners" });
  }

  const orders = await findEligibleOrders(shop, predictionIds);
  let credited = 0;

  for (const o of orders) {
    if (waitHours) {
      const created = new Date(o.createdAt).getTime();
      if (Date.now() - created < waitHours * 3_600_000) continue;
    }

    const idemp = `cred_${shop}_${o.orderId}`;
    const base = basis === "subtotal" ? o.subtotal : o.total;
    let amount = Number(base || 0);
    if (minSpend && amount < minSpend) continue;
    if (cap && amount > cap) amount = cap;
    if (amount <= 0) continue;

    try {
      if (mode === "store_credit") {
        // If upstream doesn't attach customerId, fallback by email
        let customerId: string | undefined = o.customerId;
        if (!customerId) {
          const email = o.customerEmail;
          if (!email) throw new Error("Missing customer email & id");
          customerId = await findOrCreateCustomerByEmail(admin, email);
        }

        const txn = await creditCustomer(admin, customerId!, amount, o.currency, { notify, expiresAt });

        await markCredited(o, {
          mode,
          storeCreditTxnId: txn.id,
          idempotencyKey: idemp,
          amount,
          currency: o.currency,
        });
      } else {
        const email = o.customerEmail || (await lookupCustomerEmail(admin, o.customerId));
        if (!email) throw new Error("Missing customer email for gift card");
        const resp = await admin(GIFT_CARD_CREATE, {
          idemp,
          input: {
            initialValue: amount.toFixed(2),
            currency: o.currency,
            note: "SQWAD conditional credit",
            customerEmail: email,
          },
        });
        const gc = (resp as any)?.data?.giftCardCreate?.giftCard;
        const errs = (resp as any)?.data?.giftCardCreate?.userErrors ?? [];
        if (!gc || errs.length) throw new Error(`Gift card create failed: ${JSON.stringify(errs)}`);

        await markCredited(o, {
          mode,
          giftCardId: gc.id,
          idempotencyKey: idemp,
          amount,
          currency: o.currency,
        });
      }

      credited++;
    } catch (e: any) {
      await markCredited(o, { failed: true, creditError: String(e?.message || e) });
    }
  }

  return Response.json({ ok: true, credited, totalEligible: orders.length });
};

// ---------- helpers ----------

async function findOrCreateCustomerByEmail(
  admin: ReturnType<typeof makeAdminClient>,
  email: string
): Promise<string> {
  const Q = `#graphql
    query ($email: String!) {
      customerByIdentifier(identifier: { email: $email }) {
        id
        email
      }
    }`;
  const q = await admin(Q, { email });
  const found = (q as any)?.data?.customerByIdentifier;
  if (found?.id) return found.id;

  const CREATE = `#graphql
    mutation ($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }`;
  const r = await admin(CREATE, { input: { email } });
  const errs = (r as any)?.data?.customerCreate?.userErrors ?? [];
  if (errs.length) throw new Error(`customerCreate: ${JSON.stringify(errs)}`);
  const id = (r as any)?.data?.customerCreate?.customer?.id;
  if (!id) throw new Error("customerCreate: no id returned");
  return id;
}

async function creditCustomer(
  admin: ReturnType<typeof makeAdminClient>,
  customerId: string,
  amount: number,
  currencyCode: string,
  opts?: { notify?: boolean; expiresAt?: string }
) {
  const variables: any = {
    id: customerId,
    creditInput: {
      creditAmount: { amount: amount.toFixed(2), currencyCode },
      ...(opts?.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    },
    notify: opts?.notify ?? true,
  };

  const resp = await admin(SC_CREDIT_MUT, variables);
  const data = (resp as any)?.data?.storeCreditAccountCredit;
  const errs = data?.userErrors ?? [];
  if (errs.length) throw new Error(`storeCreditAccountCredit: ${JSON.stringify(errs)}`);
  const txn = data?.storeCreditAccountTransaction;
  if (!txn?.id) throw new Error("storeCreditAccountCredit: no transaction id");
  return txn;
}

async function lookupCustomerEmail(
  admin: ReturnType<typeof makeAdminClient>,
  customerGid?: string
): Promise<string | null> {
  if (!customerGid) return null;
  const Q = `#graphql query($id:ID!){ customer(id:$id){ email } }`;
  const r = await admin(Q, { id: customerGid });
  return (r as any)?.data?.customer?.email ?? null;
}
