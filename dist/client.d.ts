import { PresenceDelta, PresenceFrame } from "./protocol.js";
import { P as Chat, U as Transport, r as ChatBox } from "./box-BwCIH9hZ.js";

//#region src/client.d.ts
/** Hidden this long before the socket is dropped. */
declare const IDLE_MS = 30000;
type HubOptions = {
  /** The hub's page-socket URL (ws:// or wss://, or a path on this origin). */url: string;
  /**
   * This page's label, shown to agents; default: path + (pwa) + user agent.
   * A function is asked again after each client-side navigation.
   */
  label?: string | (() => string); /** Report client-side navigation to the hub ({type:"page"}). Default true. */
  trackPages?: boolean; /** Run code approved agents send (eval scope). Default false. */
  evalCode?: boolean; /** Whether the socket should be up at all (beyond visibility). Default always. */
  wanted?: () => boolean; /** Each eval result, for the site's own logging. */
  onEval?: (r: {
    id: string;
    ok: boolean;
  } & Record<string, unknown>) => void; /** The node this page is on, sent as ?node= on connect (presence). Default "/". */
  node?: () => string; /** The hub's presence frames, validated; null when the socket goes down. */
  onPresence?: (f: PresenceFrame | PresenceDelta | null) => void;
};
type HubConnection = {
  /** Re-check visibility and wanted() now (call it when wanted() may have changed). */update(): void;
  close(): void; /** The headless chat behind the box. */
  chat: Chat;
};
/**
 * The hub's page socket as a transport: held while the page is visible and
 * `wanted()`, reconnected after a network drop, the tab's page id kept, its
 * client-side navigation reported, and approved eval run (only with
 * `evalCode: true`). Stop it and start it again as often as you like.
 */
declare function hubTransport(opts: HubOptions): Transport;
/** Drive a <liagent-chat> box from a hub's page socket (see the header). */
declare function connectHub(box: ChatBox, opts: HubOptions): HubConnection;
//#endregion
export { HubConnection, HubOptions, IDLE_MS, connectHub, hubTransport };
//# sourceMappingURL=client.d.ts.map