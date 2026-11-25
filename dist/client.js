import { PAGE_DEBOUNCE_MS, compile, parsePresence, summarize } from "./protocol.js";
import { i as createChat } from "./core-DxJBon4x.js";

//#region src/client.ts
/** Hidden this long before the socket is dropped. */
const IDLE_MS = 3e4;
/** This tab's page id, kept for the tab's life so a reconnect keeps its grants. */
const PAGE_KEY = "liagent:page";
const readPageId = () => {
	try {
		return sessionStorage.getItem(PAGE_KEY) ?? "";
	} catch {
		return "";
	}
};
const savePageId = (id) => {
	try {
		if (id) sessionStorage.setItem(PAGE_KEY, id);
	} catch {}
};
function socketUrl(url, label, node) {
	const u = new URL(url, location.href);
	if (u.protocol === "http:") u.protocol = "ws:";
	if (u.protocol === "https:") u.protocol = "wss:";
	u.searchParams.set("label", label);
	const page = readPageId();
	if (page) u.searchParams.set("page", page);
	if (node && node !== "/") u.searchParams.set("node", node);
	return u.toString();
}
/**
* The hub's page socket as a transport: held while the page is visible and
* `wanted()`, reconnected after a network drop, the tab's page id kept, its
* client-side navigation reported, and approved eval run (only with
* `evalCode: true`). Stop it and start it again as often as you like.
*/
function hubTransport(opts) {
	let ws = null;
	let sink = null;
	let idle;
	let nav;
	const pageLabel = () => {
		if (typeof opts.label === "function") return opts.label();
		if (opts.label) return opts.label;
		const standalone = matchMedia?.("(display-mode: standalone)").matches ? "pwa " : "";
		return `${location.pathname} ${standalone}${navigator.userAgent}`;
	};
	let sentLabel = "";
	const opened = /* @__PURE__ */ new WeakSet();
	const wanted = () => !!sink && document.visibilityState === "visible" && (opts.wanted?.() ?? true);
	const send = (sock, msg) => {
		if (!sock || sock.readyState !== WebSocket.OPEN) return false;
		try {
			sock.send(JSON.stringify(msg));
			return true;
		} catch {
			return false;
		}
	};
	const run = async (sock, id, to, code) => {
		sink?.ran();
		const t0 = performance.now();
		let result;
		try {
			const value = await compile(code)();
			result = {
				ok: true,
				ms: Math.round(performance.now() - t0),
				value: summarize(value)
			};
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			result = {
				ok: false,
				error: `${err.name}: ${err.message}`.slice(0, 1e3),
				stack: (err.stack ?? "").slice(0, 2e3)
			};
		}
		opts.onEval?.({
			id,
			...result
		});
		send(sock, {
			type: "result",
			id,
			to,
			...result
		});
	};
	const connect = () => {
		if (ws) return;
		const label = sentLabel = pageLabel();
		const initialNode = opts.node?.() ?? "/";
		const sock = new WebSocket(socketUrl(opts.url, label, initialNode));
		ws = sock;
		sink?.status("connecting");
		sock.onopen = () => {
			if (ws !== sock) return;
			opened.add(sock);
			const latestNode = opts.node?.() ?? "/";
			if (latestNode !== initialNode) send(sock, {
				type: "page",
				node: latestNode
			});
			sink?.status("live");
		};
		sock.onmessage = (e) => {
			if (ws !== sock) return;
			let msg;
			try {
				msg = JSON.parse(String(e.data));
			} catch {
				return;
			}
			if (msg?.type === "state" && typeof msg.self === "string") savePageId(msg.self);
			if (msg?.type === "presence" || msg?.type === "presence-delta") {
				const f = parsePresence(msg);
				if (f) opts.onPresence?.(f);
				return;
			}
			if (msg?.type !== "eval") return sink?.receive(msg);
			if (!opts.evalCode) return;
			if (typeof msg.id !== "string" || typeof msg.to !== "string") return;
			if (typeof msg.code !== "string") return;
			run(sock, msg.id, msg.to, msg.code);
		};
		sock.onclose = (e) => {
			if (ws !== sock) return;
			ws = null;
			sink?.status("offline");
			opts.onPresence?.(null);
			if (opened.has(sock) && e.code < 4e3 && wanted()) connect();
		};
	};
	const disconnect = () => {
		clearTimeout(idle);
		const sock = ws;
		ws = null;
		if (sock) {
			sink?.status("offline");
			opts.onPresence?.(null);
		}
		sock?.close();
	};
	const update = () => {
		clearTimeout(idle);
		if (wanted()) connect();
		else if (!sink || !(opts.wanted?.() ?? true)) disconnect();
		else if (ws) idle = setTimeout(disconnect, IDLE_MS);
	};
	const navigated = () => {
		clearTimeout(nav);
		nav = setTimeout(() => {
			const label = pageLabel();
			if (label === sentLabel) return;
			if (send(ws, {
				type: "page",
				label
			})) sentLabel = label;
		}, PAGE_DEBOUNCE_MS);
	};
	let unhook = [];
	return {
		start(s) {
			if (sink) return;
			sink = s;
			if (opts.trackPages !== false) {
				for (const k of ["pushState", "replaceState"]) {
					const orig = history[k];
					history[k] = function(...a) {
						const r = orig.apply(this, a);
						navigated();
						return r;
					};
					unhook.push(() => history[k] = orig);
				}
				addEventListener("popstate", navigated);
				unhook.push(() => removeEventListener("popstate", navigated));
			}
			document.addEventListener("visibilitychange", update);
			addEventListener("pageshow", update);
			unhook.push(() => {
				document.removeEventListener("visibilitychange", update);
				removeEventListener("pageshow", update);
			});
			update();
		},
		send: (msg) => send(ws, msg),
		update,
		stop() {
			if (!sink) return;
			clearTimeout(nav);
			for (const u of unhook) u();
			unhook = [];
			disconnect();
			sink = null;
		}
	};
}
/** Drive a <liagent-chat> box from a hub's page socket (see the header). */
function connectHub(box, opts) {
	const transport = hubTransport({
		...opts,
		node: () => box.target,
		onPresence: (f) => {
			box.presence?.(f);
			opts.onPresence?.(f);
		}
	});
	const chat = createChat({ transport });
	box.chat = chat;
	box.onSend = (text, to, o) => chat.send(text, {
		to,
		source: o?.source,
		context: o?.context,
		attachments: o?.attachments,
		ctx: o?.ctx
	});
	box.onAnswer = (type, p, answer) => void (type === "deny" ? chat.deny(p.pair) : chat.allow(p.pair, answer));
	box.onEnd = (p) => void chat.end(p.pair);
	box.onEndPage = (id) => void chat.endPage(id);
	box.onTarget = (node) => void transport.send({
		type: "page",
		node
	});
	chat.start();
	return {
		update: () => chat.update(),
		close: () => chat.close(),
		chat
	};
}

//#endregion
export { IDLE_MS, connectHub, hubTransport };
//# sourceMappingURL=client.js.map