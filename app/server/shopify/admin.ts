type GraphQLUserError = { message?: string };
type GraphQLResponse = {
  data?: Record<string, unknown>;
  errors?: unknown;
};

export type AdminClient = <
  T = unknown,
  V extends Record<string, unknown> | undefined = Record<string, unknown> | undefined
>(
  query: string,
  variables?: V
) => Promise<T>;

export function makeAdminClient(shop: string, accessToken: string, apiVersion = "2025-10"): AdminClient {
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  return async <
    T = unknown,
    V extends Record<string, unknown> | undefined = Record<string, unknown> | undefined
  >(query: string, variables?: V) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Shopify GraphQL ${response.status}: ${text}`);
    }
    const json = (await response.json()) as unknown;
    if (!json || typeof json !== "object") {
      throw new Error("Unexpected Shopify GraphQL response shape");
    }
    const result = json as GraphQLResponse;
    if (result.errors) throw new Error(JSON.stringify(result.errors));
    if (result.data) {
      const userErrors = collectUserErrors(result.data);
      if (userErrors.length) {
        throw new Error(userErrors.map(err => err.message ?? "Unknown error").join("; "));
      }
    }
    return json as T;
  };
}

function collectUserErrors(data: Record<string, unknown>): GraphQLUserError[] {
  const aggregated: GraphQLUserError[] = [];
  for (const value of Object.values(data)) {
    if (!value || typeof value !== "object") continue;
    const maybe = value as { userErrors?: unknown };
    if (!Array.isArray(maybe.userErrors)) continue;
    for (const err of maybe.userErrors) {
      if (err && typeof err === "object" && "message" in err) {
        aggregated.push({ message: String((err as { message?: unknown }).message ?? "") });
      } else {
        aggregated.push({ message: String(err) });
      }
    }
  }
  return aggregated;
}
