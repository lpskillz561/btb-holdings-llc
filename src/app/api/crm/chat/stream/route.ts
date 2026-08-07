import { subscribe, type ChatEvent } from "@/lib/crm/chat-bus";
import { withCrm } from "@/lib/crm/rest";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
// A long-lived response. Anything that tries to cache or statically analyse
// this route would break it, so say so explicitly.
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events: how a browser learns about a message it did not send.
 *
 * SSE rather than WebSockets, and rather than polling. WebSockets need a server
 * Next's route handlers cannot host, and polling at a conversational cadence is
 * a database query per person per second forever. SSE is one long-lived HTTP
 * response, which the ALB already understands, and the browser's own
 * `EventSource` reconnects on its own when it drops.
 *
 * Three things make it survive this deployment specifically:
 *
 *   1. **HEARTBEATS.** The ALB closes a connection idle for 60 seconds and a
 *      quiet chat room is idle by definition. A comment line every 25 seconds
 *      keeps it open; it is `:` so the browser ignores it as a no-op.
 *   2. **`X-Accel-Buffering: no`** and no compression. A proxy that buffers is
 *      a proxy that holds each message until it has "enough" of them, which
 *      turns a live stream into a batch delivered minutes late.
 *   3. **A CLEAN TEARDOWN on abort.** Every deploy restarts the container and
 *      drops every connection; every navigation closes one. Without unsubscribe
 *      on `close`, each of those leaks a listener on a process-lifetime emitter
 *      and the room slowly stops working.
 *
 * The gate is `withCrm`, like everything else — the stream carries the same
 * message bodies the REST route does, so it needs the same session check.
 */
export const GET = withCrm(async (req, { actor }) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client went away between the check and the write.
          open = false;
        }
      };

      // `retry:` tells EventSource how long to wait before reconnecting. Three
      // seconds so a deploy is a blip rather than the browser's default backoff.
      send(`retry: 3000\n\n`);
      send(`event: ready\ndata: ${JSON.stringify({ viewer: actor })}\n\n`);

      const unsubscribe = subscribe((event: ChatEvent) => {
        send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => send(`: keep-alive\n\n`), 25_000);

      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      req.signal.addEventListener("abort", close);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
