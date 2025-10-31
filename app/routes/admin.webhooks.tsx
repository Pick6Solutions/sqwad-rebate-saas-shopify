// app/routes/admin.webhooks.tsx  (React Router app)
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request); // ← has shop + accessToken
  const res = await fetch(
    `https://${session.shop}/admin/api/2025-10/webhooks.json`,
    {
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
    }
  );
  const text = await res.text();
  return new Response(text, { headers: { "content-type": "application/json" } });
};
