/**
 * Server-side proxy to Engineer B's API. It attaches the signed-in user's GitHub token
 * from the encrypted session cookie, so the token never reaches browser JavaScript and
 * the backend can verify who is calling against GitHub itself.
 */
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const BACKEND_URL = process.env.BACKEND_URL;

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!BACKEND_URL) {
    return Response.json({ message: "BACKEND_URL is not configured on the web server." }, { status: 503 });
  }
  const { path } = await ctx.params;
  const token = await getToken({ req });
  const headers = new Headers({ accept: "application/json" });
  if (token?.accessToken) headers.set("authorization", `Bearer ${token.accessToken}`);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  if (hasBody) headers.set("content-type", "application/json");

  const url = `${BACKEND_URL.replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? await req.text() : undefined,
      cache: "no-store",
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json({ message: "The Merit API is not reachable." }, { status: 502 });
  }
}

export { forward as GET, forward as POST };
