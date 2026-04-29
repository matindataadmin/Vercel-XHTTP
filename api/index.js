export const runtime = "edge";

const BACKEND_HOST = (process.env.BACKEND_DOMAIN || "").replace(/\/+$/, "");

const DROP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-vercel-proxy",
  "x-vercel-deployment-url",
]);

export default async function gateway(request) {
  if (!BACKEND_HOST) {
    return new Response("Backend not configured", { status: 500 });
  }

  try {
    const requestUrl = new URL(request.url);
    const destination = BACKEND_HOST + requestUrl.pathname + requestUrl.search;

    const outgoingHeaders = new Headers();
    let sourceIp = null;

    for (const [name, value] of request.headers) {
      const lowerName = name.toLowerCase();
      if (DROP_HEADERS.has(lowerName)) continue;
      if (lowerName.startsWith("x-vercel-")) continue;
      if (lowerName === "x-real-ip") {
        sourceIp = value;
        continue;
      }
      if (lowerName === "x-forwarded-for") {
        if (!sourceIp) sourceIp = value;
        continue;
      }
      outgoingHeaders.set(lowerName, value);
    }

    if (sourceIp) {
      const existing = outgoingHeaders.get("x-forwarded-for");
      const newValue = existing ? `${existing}, ${sourceIp}` : sourceIp;
      outgoingHeaders.set("x-forwarded-for", newValue);
    }

    outgoingHeaders.set("x-proxy-agent", "vercel-edge-proxy/1.0");

    const httpMethod = request.method;
    const isBodyAllowed = !["GET", "HEAD"].includes(httpMethod);

    const fetchParameters = {
      method: httpMethod,
      headers: outgoingHeaders,
      redirect: "manual",
    };

    if (isBodyAllowed) {
      fetchParameters.body = request.body;
      fetchParameters.duplex = "half";
    }

    const backendResponse = await fetch(destination, fetchParameters);

    const responseHeaders = new Headers();
    for (const [key, value] of backendResponse.headers) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === "transfer-encoding") continue;
      if (lowerKey === "via") continue;
      responseHeaders.set(key, value);
    }

    responseHeaders.set("x-proxied-by", "vercel-edge");

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("proxy error:", error);
    return new Response("Gateway Error: Unable to reach origin", { status: 502 });
  }
}
