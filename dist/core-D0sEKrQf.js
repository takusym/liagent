import { BUSY_AFTER_REPLY_MS, BUSY_MS, applyEdit, chatText, cleanCtx, cleanReply, trimHistory } from "./protocol.js";
import { i as silenceFor, r as pageHidden } from "./speak-rules-CuM1k5aH.js";

//#region src/core.ts
/** How long `evalRan` stays true after code ran on this page. */
const RAN_MS = 4e3;
const INITIAL = Object.freeze({
	status: "idle",
	messages: Object.freeze([]),
	outbox: Object.freeze([]),
	pending: null,
	sessions: Object.freeze([]),
	listeners: 0,
	nodes: Object.freeze([]),
	pages: Object.freeze([]),
	self: "",
	busy: false,
	evalRan: false,
	friend: false,
	notice: "",
	warning: ""
});
/** The strings the core sets itself (the box shows them as they are). */
const CHAT_STRINGS = {
	blocked: "Chat is not available for this account.",
	rateLimited: (min) => `Too many messages: that one was not sent. Try again in ${min} min.`
};
/** True when the browser says a user gesture is active now, or cannot say. */
function userActive() {
	const ua = globalThis.navigator?.userActivation;
	return !ua || ua.isActive;
}
/** Equal for the snapshot: the same value, or two lists with the same items. */
function same(a, b) {
	if (Object.is(a, b)) return true;
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
	return a.every((x, i) => Object.is(x, b[i]) || JSON.stringify(x) === JSON.stringify(b[i]));
}
const list = (v) => Object.freeze(Array.isArray(v) ? [...v] : []);
function createChat(opts = {}) {
	const now = opts.now ?? Date.now;
	const later = opts.setTimeout ?? ((f, ms) => setTimeout(f, ms));
	const cancel = opts.clearTimeout ?? ((t) => clearTimeout(t));
	const newId = opts.newId ?? (() => crypto.randomUUID().slice(0, 12));
	const transport = opts.transport;
	let state = INITIAL;
	const subs = /* @__PURE__ */ new Set();
	const handlers = {
		message: /* @__PURE__ */ new Set(),
		history: /* @__PURE__ */ new Set(),
		edit: /* @__PURE__ */ new Set(),
		announce: /* @__PURE__ */ new Set()
	};
	let busyTimer;
	let ranTimer;
	let lastReplyAt = -Infinity;
	let started = false;
	let stopping = false;
	let closed = false;
	const emit = (k, ...a) => {
		for (const f of handlers[k]) f(...a);
	};
	/** Replace the snapshot with the changed fields; notify only if any changed. */
	const commit = (patch) => {
		let next = null;
		for (const [k, v] of Object.entries(patch)) {
			if (same(state[k], v)) continue;
			next ??= { ...state };
			next[k] = v;
		}
		if (!next) return;
		if ("busy" in patch) cancel(busyTimer);
		state = Object.freeze(next);
		for (const f of subs) f(state);
	};
	/** The host's fields, cleaned the way the box's setters always cleaned them. */
	const set = (p) => {
		const out = {};
		if (p.status !== void 0) out.status = p.status;
		if ("pending" in p) out.pending = p.pending ?? null;
		if (p.sessions !== void 0) out.sessions = list(p.sessions);
		if (p.listeners !== void 0) out.listeners = Number(p.listeners) || 0;
		if (p.nodes !== void 0) out.nodes = Object.freeze(list(p.nodes).filter((n) => typeof n === "string"));
		if (p.pages !== void 0) out.pages = list(p.pages);
		if (p.self !== void 0) out.self = p.self ?? "";
		if (p.busy !== void 0) out.busy = !!p.busy;
		if (p.evalRan !== void 0) out.evalRan = !!p.evalRan;
		if (p.friend !== void 0) out.friend = !!p.friend;
		if ("notice" in p) out.notice = p.notice ?? "";
		if ("warning" in p) out.warning = p.warning ?? "";
		const wasPending = state.pending?.pair;
		commit(out);
		const pend = state.pending;
		if (pend && pend.pair !== wasPending) emit("announce", `${pend.label || "An agent"} asks to connect: code ${pend.code}`, "pairing");
	};
	const setOutbox = (f) => commit({ outbox: Object.freeze(f(state.outbox)) });
	const push = (m) => {
		if (!m || typeof m !== "object" || typeof m.text !== "string" || typeof m.id !== "string") return;
		if (state.outbox.some((o) => o.id === m.id)) setOutbox((o) => o.filter((x) => x.id !== m.id));
		if (state.messages.some((x) => x.id === m.id)) return;
		const patch = { messages: Object.freeze(trimHistory([...state.messages, m])) };
		if (m.from !== "agent") patch.warning = "";
		else {
			lastReplyAt = now();
			patch.busy = false;
		}
		commit(patch);
		emit("message", m, { live: true });
		if (m.from === "agent") emit("announce", m.text, "reply");
	};
	const setMessages = (v) => {
		const messages = Object.freeze(trimHistory(Array.isArray(v) ? [...v] : []));
		const ids = new Set(messages.map((m) => m.id));
		commit({ messages });
		if (state.outbox.some((o) => ids.has(o.id))) setOutbox((o) => o.filter((x) => !ids.has(x.id)));
		emit("history", state.messages);
	};
	const edit = (e) => {
		if (!e || typeof e.id !== "string" || typeof e.text !== "string") return;
		commit({ messages: Object.freeze(state.messages.map((m) => applyEdit(m, e))) });
		emit("edit", e);
	};
	const beat = (at = now()) => {
		if (at - lastReplyAt < BUSY_AFTER_REPLY_MS) return;
		commit({ busy: true });
		cancel(busyTimer);
		busyTimer = later(() => commit({ busy: false }), BUSY_MS);
	};
	const receive = (raw) => {
		if (!raw || typeof raw !== "object") return;
		const msg = raw;
		switch (msg.type) {
			case "friend-status": return set({
				friend: true,
				notice: msg.status === "blocked" ? CHAT_STRINGS.blocked : ""
			});
			case "rate-limited": {
				const min = Math.max(1, Math.ceil(Number(msg.retryIn) / 6e4) || 1);
				if (typeof msg.id === "string") setOutbox((o) => o.map((x) => x.id === msg.id ? {
					...x,
					status: "failed"
				} : x));
				return set({ warning: CHAT_STRINGS.rateLimited(min) });
			}
			case "state": {
				const s = msg;
				const sessions = Array.isArray(s.sessions) ? s.sessions : [];
				return set({
					pending: s.pending ?? null,
					sessions,
					listeners: s.listeners ?? sessions.length,
					nodes: Array.isArray(s.nodes) ? s.nodes : [],
					pages: Array.isArray(s.pages) ? s.pages : [],
					self: typeof s.self === "string" ? s.self : ""
				});
			}
			case "busy": return beat();
			case "history":
				if (Array.isArray(msg.messages)) setMessages(msg.messages);
				return;
			case "chat": return push(msg.message);
			case "edited": return edit(msg);
		}
	};
	const out = (msg) => !closed && !!transport?.send(msg);
	const sendLine = (e) => out({
		type: "chat",
		id: e.id,
		text: e.text,
		...e.to ? { to: e.to } : {},
		...e.source ? { source: e.source } : {},
		...e.context ? { context: e.context } : {},
		...e.attachments?.length ? { attachments: e.attachments } : {},
		...e.ctx ? { ctx: e.ctx } : {},
		...e.replyTo ? { replyTo: e.replyTo } : {}
	});
	const sink = {
		receive,
		status(s) {
			if (closed) return;
			if (s === "live" || s === "connecting") return commit({ status: s });
			commit({
				status: s,
				pending: null,
				sessions: INITIAL.sessions,
				pages: INITIAL.pages
			});
			commit({ busy: false });
			if (state.outbox.some((o) => o.status === "sending")) setOutbox((o) => o.map((x) => x.status === "sending" ? {
				...x,
				status: "failed"
			} : x));
		},
		ran() {
			cancel(ranTimer);
			commit({ evalRan: true });
			ranTimer = later(() => commit({ evalRan: false }), RAN_MS);
		}
	};
	const halt = () => {
		stopping = false;
		if (!started) return;
		started = false;
		transport?.stop();
	};
	return {
		getState: () => state,
		subscribe(fn) {
			subs.add(fn);
			return () => void subs.delete(fn);
		},
		on(event, fn) {
			handlers[event].add(fn);
			return () => void handlers[event].delete(fn);
		},
		send(text, o = {}) {
			const t = chatText(text);
			if (!t) return false;
			const ctx = cleanCtx(o.ctx);
			const replyTo = cleanReply(o.replyTo);
			const e = {
				id: newId(),
				text: t,
				...o.to ? { to: o.to } : {},
				...o.source ? { source: o.source } : {},
				...o.context ? { context: o.context } : {},
				...o.attachments?.length ? { attachments: o.attachments } : {},
				...ctx ? { ctx } : {},
				...replyTo ? { replyTo } : {}
			};
			if (!sendLine(e)) return false;
			setOutbox((x) => [...x, {
				...e,
				at: now(),
				status: "sending"
			}]);
			return true;
		},
		retry(id) {
			const e = state.outbox.find((x) => x.id === id && x.status === "failed");
			if (!e || !sendLine(e)) return false;
			setOutbox((o) => o.map((x) => x.id === id ? {
				...x,
				status: "sending",
				at: now()
			} : x));
			return true;
		},
		dismiss(id) {
			if (state.outbox.some((x) => x.id === id)) setOutbox((o) => o.filter((x) => x.id !== id));
		},
		allow(pair, answer = {}) {
			if (opts.requireActivation !== false && !userActive()) return false;
			return out({
				type: "allow",
				pair,
				...answer.pages ? { pages: answer.pages } : {},
				...answer.scope ? { scope: answer.scope } : {}
			});
		},
		deny: (pair) => out({
			type: "deny",
			pair
		}),
		end: (pair) => out({
			type: "revoke",
			pair
		}),
		endPage: (id) => out({
			type: "end-page",
			id
		}),
		start() {
			if (closed) return;
			stopping = false;
			if (started) return;
			started = true;
			transport?.start(sink);
		},
		stop() {
			if (!started || stopping) return;
			stopping = true;
			queueMicrotask(() => stopping && halt());
		},
		update: () => void (started && transport?.update?.()),
		close() {
			if (closed) return;
			halt();
			closed = true;
			cancel(ranTimer);
			commit({
				status: "closed",
				pending: null,
				sessions: INITIAL.sessions,
				pages: INITIAL.pages
			});
			commit({
				busy: false,
				evalRan: false
			});
		},
		receive,
		push,
		setMessages,
		edit,
		beat,
		set
	};
}
/**
* Read the agent's live replies through `v`, by the box's rules: never
* history, never a `quiet` line, never while the page is hidden
* (src/speak-rules.ts). Returns unhook.
*/
function connectVoice(chat, v, opts = {}) {
	const hidden = opts.hidden ?? pageHidden;
	return chat.on("message", (m, { live }) => {
		if (!live || m.from !== "agent") return;
		if (silenceFor(m, { hidden: hidden() })) return;
		v.speak(m.text, m.id);
	});
}

//#endregion
export { userActive as a, createChat as i, RAN_MS as n, connectVoice as r, CHAT_STRINGS as t };
//# sourceMappingURL=core-D0sEKrQf.js.map