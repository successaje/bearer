/** Plain JSON-RPC and REST over `fetch`, so the adapter runs in browsers, Node and edge runtimes alike. */

export class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly detail: unknown,
  ) {
    super(`${method}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
}

export async function jsonRpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "bearer", method, params }),
  });
  const body = await res.json();
  const err = body.error ?? body.result?.error;
  if (err) throw new RpcError(method, err);
  return body.result as T;
}

export async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new RpcError(`GET ${url}`, await res.text());
  return (await res.json()) as T;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();
/** UTF-8, then base64, the same in browsers and Node (both have btoa). */
const toBase64 = (s: string) => btoa(Array.from(encoder.encode(s), (b) => String.fromCharCode(b)).join(""));

/** NEAR's view calls and account checks, read at `final` finality unless asked otherwise. */
export class NearRpc {
  constructor(readonly url: string) {}

  query<T>(params: Record<string, unknown>, finality: "final" | "optimistic" = "final") {
    return jsonRpc<T>(this.url, "query", { finality, ...params });
  }

  async view<T>(contractId: string, method: string, args: object = {}, finality: "final" | "optimistic" = "optimistic"): Promise<T> {
    const r = await this.query<{ result: number[] }>(
      { request_type: "call_function", account_id: contractId, method_name: method, args_base64: toBase64(JSON.stringify(args)) },
      finality,
    );
    return JSON.parse(decoder.decode(new Uint8Array(r.result))) as T;
  }

  async accountExists(accountId: string) {
    try {
      await this.query({ request_type: "view_account", account_id: accountId });
      return true;
    } catch (e) {
      if (e instanceof RpcError && /UNKNOWN_ACCOUNT|does not exist/i.test(JSON.stringify(e.detail))) return false;
      throw e;
    }
  }
}
