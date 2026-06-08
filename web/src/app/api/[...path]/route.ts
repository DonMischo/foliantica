import { NextRequest } from "next/server";

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const apiPort = process.env.LW_API_PORT ?? "8765";
  const { search } = req.nextUrl;
  const target = `http://127.0.0.1:${apiPort}/api/${path.join("/")}${search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");

  // Forward the real client IP so the FastAPI co-work auth middleware can
  // distinguish host (127.0.0.1) from remote guest requests.
  const realIp =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";
  headers.set("X-Client-IP", realIp);

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const contentType = req.headers.get("content-type") ?? "";
    init.body = contentType.includes("multipart/form-data")
      ? await req.formData()
      : req.body;
    (init as RequestInit & { duplex?: string }).duplex = "half";
  }

  try {
    return fetch(target, init);
  } catch {
    return new Response("Backend unavailable", { status: 503 });
  }
}

export const GET     = handler;
export const POST    = handler;
export const PUT     = handler;
export const PATCH   = handler;
export const DELETE  = handler;
export const HEAD    = handler;
export const OPTIONS = handler;
