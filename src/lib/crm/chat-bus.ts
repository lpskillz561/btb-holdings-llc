/**
 * The live fan-out behind the chat's SSE stream.
 *
 * IN-PROCESS, on purpose. There is ONE instance behind the load balancer — a
 * deliberate shape, recorded in CLAUDE.md, and the reason the health check does
 * not touch the database — so an EventEmitter reaches every connected browser
 * without Redis, without a second process, and without a WebSocket server that
 * Next's route handlers cannot host anyway.
 *
 * **This is the one thing that breaks if a second instance is ever added.**
 * Each would fan out only to its own connections and half the office would stop
 * seeing the other half's messages, with no error anywhere. That is the trade,
 * and it is worth taking today: the alternative is standing up a broker for a
 * five-person team.
 *
 * The module-level emitter survives hot reload in dev by hanging off
 * `globalThis` — otherwise every edit leaks a fresh emitter with the old
 * subscribers still attached to the old one.
 */

import { EventEmitter } from "node:events";
import type { CrmChatMessage } from "./chat";
import type { CrmDocumentSummary } from "./documents";
import type { LinkPreview } from "./unfurl";

export type ChatEvent =
  | { type: "message"; channelId: string; message: CrmChatMessage }
  | { type: "update"; channelId: string; message: CrmChatMessage }
  | { type: "delete"; channelId: string; messageId: string }
  | { type: "preview"; channelId: string; messageId: string; preview: LinkPreview }
  // A document finished being read, or was adopted or withdrawn. NOT scoped to a
  // channel, unlike everything else here: the same document can be linked from
  // several messages in several rooms and from the library page, and the browser
  // updates every card carrying that id. Scoping it would mean the card that
  // prompted the upload updating and its copy two rooms over sitting at "being
  // read" forever.
  | { type: "document"; document: CrmDocumentSummary }
  | { type: "typing"; channelId: string; actor: string };

const KEY = Symbol.for("btb.chat.bus");

interface Global {
  [KEY]?: EventEmitter;
}

function bus(): EventEmitter {
  const g = globalThis as unknown as Global;
  if (!g[KEY]) {
    const emitter = new EventEmitter();
    // One listener per open browser tab, and the default cap of 10 would print
    // a spurious leak warning the moment six people opened two tabs each.
    emitter.setMaxListeners(0);
    g[KEY] = emitter;
  }
  return g[KEY];
}

export function publish(event: ChatEvent): void {
  bus().emit("chat", event);
}

export function subscribe(listener: (event: ChatEvent) => void): () => void {
  bus().on("chat", listener);
  return () => {
    bus().off("chat", listener);
  };
}
