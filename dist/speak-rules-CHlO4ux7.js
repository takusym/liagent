import { MAX_SELECTION, cleanContext } from "./protocol.js";
import { i as crumbs } from "./state-tree-U_1Vg6uJ.js";

//#region src/attach.ts
/**
* The box's actions: the "+" menu and the bar's own buttons, as one
* pluggable list the host owns (box.actions). Each action says where it
* goes — in the + menu (`place: "menu"`, the default), or as a button at the
* bar's start (`"leading"`) or end (`"trailing"`) — so moving a feature from
* the bar into the menu is a one-word change in the host's config.
*
* An action either does something (`onSelect`) or attaches something to the
* line being typed (`attach`, returning a ChatContext: a selection and the
* page it came from, files the host uploaded). What is attached shows as a
* chip over the input (× drops it) and goes out with the next line as its
* `context` (src/protocol.ts cleanContext).
*
* Built-in providers, all optional and generic:
*   - selectionAction(): the page's last selection made outside the box
*     (kept while the user goes to the input: a phone clears the page's
*     selection when the input takes focus), never from a password, a
*     one-time-code or card field, or anything under [data-sensitive];
*     at most MAX_SELECTION chars; forgotten after SELECTION_TTL_MS, a tap
*     elsewhere on the page, or a send.
*   - fileAction({ upload }) / mediaAction({ upload }): a file picker whose
*     files the HOST uploads (`upload(file)` → {url, name, type?, size?});
*     liagent never sends file bytes over the chat.
*   - fileAction() / mediaAction() without `upload`: an upload action
*     (`upload: true`): the box opens the picker with its `accept` and puts
*     the files in its pending list, stored through the host's `box.files`
*     (src/files.ts); without `box.files` it shows disabled.
*
* Pure apart from the DOM it is handed (SelectionDeps), so it is unit tested
* with fakes (test/attach.test.ts).
*/
/** The actions for one place, in the host's order; a later duplicate id is dropped. */
function actionsAt(list, place) {
	const seen = /* @__PURE__ */ new Set();
	return list.filter((a) => {
		if (!a?.id || seen.has(a.id)) return false;
		seen.add(a.id);
		return (a.place ?? "menu") === place;
	});
}
/** The menu's actions grouped: ungrouped first, then each group in first-seen order. */
function menuGroups(list) {
	const out = [];
	for (const a of actionsAt(list, "menu")) {
		const g = out.find((x) => x.group === a.group);
		if (g) g.items.push(a);
		else out.push({
			group: a.group,
			items: [a]
		});
	}
	const i = out.findIndex((x) => x.group === void 0);
	if (i > 0) out.unshift(...out.splice(i, 1));
	return out;
}
/** Whether an action can be picked now (a throwing `enabled` counts as off). */
function actionEnabled(a) {
	try {
		return a.enabled ? a.enabled() !== false : true;
	} catch {
		return false;
	}
}
/** How long a remembered selection stays attachable. */
const SELECTION_TTL_MS = 30 * 6e4;
/** The box's own elements: a selection in them is never attached. */
const CHAT_FENCE = "liagent-chat, [data-liagent-chat]";
/** Marks a part of a page whose text is never captured (any page may use it). */
const SENSITIVE = "[data-sensitive], [data-liagent-sensitive]";
const SENSITIVE_AUTOCOMPLETE = /password|one-time-code|cc-|csc/i;
/** A field (or a part of the page) whose text must never be attached. */
function isSensitive(el) {
	if (!el) return false;
	if (el.tagName === "INPUT") {
		if ((el.type ?? "").toLowerCase() === "password") return true;
		if (SENSITIVE_AUTOCOMPLETE.test(el.getAttribute?.("autocomplete") ?? "")) return true;
	}
	return !!el.closest?.(SENSITIVE);
}
const elementOf = (n) => !n ? null : n.nodeType === 1 ? n : n.parentElement ?? null;
/** What is selected now outside the chat: "" when nothing, null when it must be left alone. */
function readSelection(d) {
	const a = d.doc.activeElement;
	if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && !d.inChat(a)) {
		if (isSensitive(a) || d.fence && a.closest?.(d.fence)) return null;
		const s = a.selectionStart ?? 0;
		const e = a.selectionEnd ?? 0;
		if (e > s) return (a.value ?? "").slice(s, e);
	}
	const sel = d.doc.getSelection();
	if (!sel || !sel.rangeCount || sel.isCollapsed) return "";
	if (d.inChat(sel.anchorNode) || d.inChat(sel.focusNode)) return null;
	if ([elementOf(sel.anchorNode), elementOf(sel.focusNode)].some((e) => isSensitive(e) || d.fence && e?.closest?.(d.fence))) return null;
	const fences = [
		SENSITIVE,
		CHAT_FENCE,
		d.fence
	].filter(Boolean).join(", ");
	const fenced = d.doc.querySelectorAll?.(fences);
	if (fenced?.length && sel.getRangeAt) for (let i = 0; i < sel.rangeCount; i++) {
		const r = sel.getRangeAt(i);
		for (let j = 0; j < fenced.length; j++) if (r.intersectsNode(fenced[j])) return null;
	}
	return sel.toString();
}
/**
* The last non-empty selection made outside the chat. Cleared by a press
* elsewhere on the page that leaves nothing selected, by clear(), and when
* older than SELECTION_TTL_MS.
*/
function createSelectionMemory(d) {
	const now = d.now ?? Date.now;
	const fences = new Set(d.fence ? [d.fence] : []);
	const read = () => readSelection({
		...d,
		fence: [...fences].join(", ") || void 0
	});
	let kept = null;
	let downInChat = false;
	const subs = /* @__PURE__ */ new Set();
	const set = (v) => {
		if (v === kept || v && kept && v.selection === kept.selection && v.path === kept.path) return;
		kept = v;
		for (const f of subs) f();
	};
	const onDown = (e) => {
		downInChat = d.inChat(e.target);
	};
	const onChange = () => {
		const text = read();
		if (text === null) return;
		const trimmed = text.trim();
		if (trimmed) {
			const ctx = cleanContext({
				...d.where(),
				selection: trimmed.slice(0, MAX_SELECTION)
			});
			if (ctx?.selection) set({
				...ctx,
				selection: ctx.selection,
				at: now()
			});
			return;
		}
		if (downInChat || d.inChat(d.doc.activeElement)) return;
		set(null);
	};
	return {
		start() {
			d.doc.addEventListener("pointerdown", onDown, true);
			d.doc.addEventListener("selectionchange", onChange);
			return () => {
				d.doc.removeEventListener("pointerdown", onDown, true);
				d.doc.removeEventListener("selectionchange", onChange);
			};
		},
		get() {
			return kept && now() - kept.at <= SELECTION_TTL_MS ? kept : null;
		},
		clear: () => set(null),
		addFence(selector) {
			if (!selector || fences.has(selector)) return;
			fences.add(selector);
			if (kept) set(null);
		},
		subscribe(f) {
			subs.add(f);
			return () => void subs.delete(f);
		},
		_events: {
			onDown,
			onChange
		}
	};
}
/** One line of a selection, for a chip: whitespace collapsed. */
const oneLine = (s) => s.replace(/\s+/g, " ").trim();
function domInChat(node) {
	const n = node;
	if (!n || typeof n !== "object") return false;
	const el = n.nodeType === 1 ? n : n.parentElement;
	if (!el?.closest) return false;
	if (el.closest(CHAT_FENCE)) return true;
	const root = el.getRootNode?.();
	return !!root && "host" in root && !!root.host?.closest?.(CHAT_FENCE);
}
const MEMORY_KEY = "__liagentSelection";
/**
* The page's selection memory, made and started once (every copy of the
* module shares it, on globalThis). Null where there is no DOM. Each
* caller's `fence` is added to it; `host` is the first caller's.
*/
function pageSelection(opts = {}) {
	if (typeof document === "undefined") return null;
	const g = globalThis;
	const have = g[MEMORY_KEY];
	if (have) {
		have.addFence?.(opts.fence);
		return have;
	}
	const m = createSelectionMemory({
		doc: document,
		inChat: domInChat,
		fence: opts.fence,
		where: () => ({
			path: location.pathname,
			title: document.title,
			...opts.host ? { host: location.host } : {}
		})
	});
	m.start();
	g[MEMORY_KEY] = m;
	return m;
}
/** "Attach the selection": the page's last selection outside the box, as context. */
function selectionAction(o = {}) {
	const mem = () => o.memory !== void 0 ? o.memory : pageSelection(o);
	mem()?.addFence(o.fence);
	return {
		id: o.id ?? "selection",
		label: o.label ?? "Attach the selection",
		icon: o.icon ?? "❝",
		group: o.group,
		place: o.place,
		enabled: () => !!mem()?.get(),
		hint: () => {
			const s = mem()?.get();
			return s ? `“${oneLine(s.selection)}”` : o.none ?? "Select text on the page first";
		},
		subscribe: (f) => mem()?.subscribe(f) ?? (() => {}),
		attach: () => {
			const s = mem()?.get();
			if (!s) return null;
			const { at: _at, ...ctx } = s;
			return ctx;
		},
		sent: () => mem()?.clear()
	};
}
function pickFiles(accept, multiple) {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		if (accept) input.accept = accept;
		input.multiple = multiple;
		input.style.display = "none";
		input.addEventListener("change", () => {
			resolve([...input.files ?? []]);
			input.remove();
		});
		input.addEventListener("cancel", () => {
			resolve([]);
			input.remove();
		});
		document.body.append(input);
		input.click();
	});
}
/**
* "Attach a file": the host's upload hook, each result attached as a file;
* without one, an upload action the box stores through `box.files`.
*/
function fileAction(o = {}) {
	const base = {
		id: o.id ?? "file",
		label: o.label ?? "Attach a file",
		icon: o.icon ?? "📎",
		group: o.group,
		place: o.place
	};
	const upload = o.upload;
	if (!upload) return {
		...base,
		upload: true,
		...o.accept ? { accept: o.accept } : {}
	};
	return {
		...base,
		attach: async (host) => {
			const files = await (o.pick ?? pickFiles)(o.accept, o.multiple ?? true);
			const done = [];
			for (const f of files) try {
				done.push(await upload(f));
			} catch (e) {
				host.notice(o.failed?.(f, e) ?? `Could not attach ${f.name}`);
			}
			return done.length ? cleanContext({ files: done }) : null;
		}
	};
}
/** "Attach a photo or video": fileAction for media (image, video, audio). */
function mediaAction(o = {}) {
	return fileAction({
		id: "media",
		label: "Attach a photo or video",
		icon: "🖼",
		accept: "image/*,video/*,audio/*",
		...o
	});
}

//#endregion
//#region src/log-pin.ts
/**
* Keeping the log on its newest line while things around it change size.
*
* The log follows new lines only from its end (src/box.ts atEnd). When the
* log or its lines change size — the input grows or shrinks, the on-screen
* keyboard opens, the text size changes, the box is moved or a panel opens —
* a log that was at its end must stay there, and the scroll the re-pin itself
* causes (it lands a frame later, sometimes after the log shrank again) must
* not count as the user leaving the end. Only the user's own scrolling does.
*
* Pure, so it is unit tested (test/log-pin.test.ts).
*/
/** Within this many px of the end, the log counts as at its end. */
const END_SLACK_PX = 4;
/**
* The scrollTop that keeps a log at its end after a size change, or null
* when nothing needs to move (scrolled up: never pinned).
*/
function repinEnd(d) {
	if (!d.atEnd) return null;
	const max = Math.max(0, d.scrollHeight - d.clientHeight);
	return Math.abs(max - d.scrollTop) > 1 ? max : null;
}
/**
* Whether the log is at its end after a scroll event: within END_SLACK_PX
* of it, or the scroll was the re-pin's own (and the user did not scroll
* since).
*/
function stillAtEnd(d) {
	if (d.gap < END_SLACK_PX) return true;
	return d.ownPin && !d.userScrolled;
}
/**
* Whether the log is at its end after a scroll event or a re-render. Only the
* user's own scrolling leaves the end: a layout change (history rendered while
* the box was hidden, a host showing it after mount, the log rebuilt, which
* clamps scrollTop to 0 for a moment) never does. A log that is not laid out
* (clientHeight 0) keeps what it had.
*/
function atEndAfter(d) {
	if (!d.clientHeight) return d.atEnd;
	return stillAtEnd({
		gap: d.gap,
		ownPin: d.atEnd && !d.userScrolled,
		userScrolled: d.userScrolled
	});
}

//#endregion
//#region src/detent.ts
/** The thing's position for a finger travel: the snapping staircase, then the rubber band. */
function snapDetent(finger, o) {
	const max = finger >= 0 ? o.max : -(o.min ?? -o.max);
	const f = Math.abs(finger);
	const top = max * o.cell;
	const x = f <= top ? o.unit * (f / o.cell - o.snap * Math.sin(2 * Math.PI * f / o.cell) / (2 * Math.PI)) : Math.min(o.stop, max * o.unit + (f - top) * o.stretch);
	return Math.sign(finger) * x;
}
/**
* The level after `t` cells of travel, from level `from`, with hysteresis
* both ways: it moves on only `hysteresis` past a midpoint, so a finger
* resting on a boundary never flickers.
*/
function detentLevel(t, from, o) {
	let k = from;
	while (k < o.max && t > k + .5 + o.hysteresis) k++;
	while (k > o.min && t < k - .5 - o.hysteresis) k--;
	return k;
}

//#endregion
//#region src/tree-nav.ts
/**
* Navigating a tree by detents: a pure reducer, `treeNav(state, event)`.
* Generic: any tree (the chat box's tree view uses it).
*
* The view: at each level the collapsed siblings sit in a row of chips; one
* node is expanded at a time along one branch (an accordion), its subtree
* shown `expanded[id]` levels deep. A focused node takes the gestures.
*
* - Dragging right by k cells expands the focused node one level per cell,
*   up to `maxDetent` (min(3, its subtree's height)); a leaf can't expand.
* - Dragging left collapses one level per cell: first the focused node's own
*   depth, deepest level first; past its own level the focus moves to its
*   parent, whose depth then drops by one; at a top-level chip with nothing
*   expanded there is nothing left to collapse.
* - At either limit the reducer stops: no wrap-around, the SAME state object
*   back (or once, the state with `atLimit` set), so the view can rubber-band.
* - A drag previews (`preview`) and commits only on `dragEnd`.
*
* It is not a counter: the result depends on the path (the focus moves, and
* each node has its own depth), so "expand 2 then collapse 1" and "collapse 1
* then expand 2" can differ.
*/
/** Build a NavIndex from any tree. */
function indexTree(roots, childrenOf, idOf) {
	const ix = {
		roots: [],
		parent: /* @__PURE__ */ new Map(),
		children: /* @__PURE__ */ new Map()
	};
	const go = (n, parent, i) => {
		const id = idOf(n, parent, i);
		ix.parent.set(id, parent);
		ix.children.set(id, childrenOf(n).map((c, j) => go(c, id, j)));
		return id;
	};
	ix.roots = roots.map((r, i) => go(r, null, i));
	return ix;
}
/** Levels below a node: 0 for a leaf. */
function height(ix, id) {
	const kids = ix.children.get(id) ?? [];
	return kids.length ? 1 + Math.max(...kids.map((k) => height(ix, k))) : 0;
}
/** How deep a node can open: min(3, its subtree's height); 0 for a leaf. */
const MAX_DETENT = 3;
function maxDetent(ix, id) {
	return Math.min(MAX_DETENT, height(ix, id));
}
const initialNav = (ix) => ({
	focusId: ix.roots[0] ?? null,
	expanded: {},
	detent: 0
});
/** The ancestors of a node, nearest first. */
function ancestors(ix, id) {
	const out = [];
	for (let p = ix.parent.get(id) ?? null; p !== null; p = ix.parent.get(p) ?? null) out.push(p);
	return out;
}
const topOf = (ix, id) => ancestors(ix, id).at(-1) ?? id;
/** Is a node on screen: a top-level chip, or within an expanded ancestor's depth. */
function isVisible(ix, s, id) {
	const up = ancestors(ix, id);
	if (!up.length) return true;
	if (!isVisible(ix, s, up[0])) return false;
	return up.some((a, i) => (s.expanded[a] ?? 0) >= i + 1);
}
/** Drop depths of nodes no longer on screen, and anything outside `top`'s branch. */
function prune(ix, e, top) {
	const out = {};
	for (const [id, d] of Object.entries(e)) if (d > 0 && (top === null || topOf(ix, id) === top)) out[id] = d;
	for (let changed = true; changed;) {
		changed = false;
		for (const id of Object.keys(out)) if (!isVisible(ix, { expanded: out }, id)) {
			delete out[id];
			changed = true;
		}
	}
	return out;
}
function expandStep(ix, s) {
	const f = s.focusId;
	if (f === null) return {
		s,
		limit: "max"
	};
	const d = s.expanded[f] ?? 0;
	if (d >= maxDetent(ix, f)) return {
		s,
		limit: "max"
	};
	const e = prune(ix, {
		...s.expanded,
		[f]: d + 1
	}, topOf(ix, f));
	return { s: {
		...s,
		expanded: e
	} };
}
function collapseStep(ix, s) {
	const f = s.focusId;
	if (f === null) return {
		s,
		limit: "min"
	};
	const d = s.expanded[f] ?? 0;
	if (d > 0) {
		const e = {
			...s.expanded,
			[f]: d - 1
		};
		return { s: {
			...s,
			expanded: prune(ix, e, topOf(ix, f))
		} };
	}
	const p = ix.parent.get(f) ?? null;
	if (p === null) return {
		s,
		limit: "min"
	};
	const pd = s.expanded[p] ?? 1;
	const e = {
		...s.expanded,
		[p]: Math.max(0, pd - 1)
	};
	return { s: {
		...s,
		focusId: p,
		expanded: prune(ix, e, topOf(ix, p))
	} };
}
/** `n` steps (signed) from `s`, stopping at a limit. */
function steps(ix, s, n) {
	let cur = { s };
	for (let i = 0; i < Math.abs(n); i++) {
		const next = n > 0 ? expandStep(ix, cur.s) : collapseStep(ix, cur.s);
		if (next.limit) return {
			s: cur.s,
			limit: next.limit
		};
		cur = next;
	}
	return cur;
}
/** The same object when nothing changes; else the new one. */
function settle(prev, next, limit) {
	const out = limit ? {
		...next,
		atLimit: limit
	} : next.atLimit ? {
		...next,
		atLimit: void 0
	} : next;
	if (out.focusId === prev.focusId && out.detent === prev.detent && out.atLimit === prev.atLimit && out.base === prev.base && sameDepths(out.expanded, prev.expanded)) return prev;
	return out;
}
const sameDepths = (a, b) => {
	const ka = Object.keys(a);
	return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};
/** Siblings of a node, in order. */
const siblings = (ix, id) => {
	const p = ix.parent.get(id) ?? null;
	return p === null ? ix.roots : ix.children.get(p) ?? [];
};
function treeNav(ix, s, ev) {
	switch (ev.type) {
		case "dragStart": return {
			...s,
			base: s.base ?? {
				...s,
				base: void 0
			},
			detent: 0,
			atLimit: void 0
		};
		case "dragMove": {
			const base = s.base ?? s;
			const r = steps(ix, base, ev.cells);
			return settle(s, {
				...r.s,
				base,
				detent: ev.cells
			}, r.limit);
		}
		case "dragEnd":
			if (!s.base) return s;
			return {
				...s,
				base: void 0,
				detent: 0,
				atLimit: void 0
			};
		case "dragCancel": return s.base ? {
			...s.base,
			base: void 0,
			detent: 0,
			atLimit: void 0
		} : s;
		case "tapChip": {
			if (!ix.parent.has(ev.id)) return s;
			const top = topOf(ix, ev.id);
			const d = s.expanded[ev.id] ?? 0;
			const want = d === 0 && maxDetent(ix, ev.id) > 0 ? 1 : d;
			const e = prune(ix, {
				...s.expanded,
				[ev.id]: want
			}, top);
			return settle(s, {
				...s,
				focusId: ev.id,
				expanded: e,
				base: void 0,
				detent: 0
			});
		}
		case "collapseAll": return settle(s, {
			focusId: s.focusId === null ? null : topOf(ix, s.focusId),
			expanded: {},
			detent: 0
		});
		case "key": {
			const f = s.focusId;
			if (f === null) return s;
			const sib = siblings(ix, f);
			const i = sib.indexOf(f);
			const step = (n) => {
				const r = steps(ix, s, n);
				return settle(s, r.s, r.limit);
			};
			switch (ev.key) {
				case "ArrowRight": return i < sib.length - 1 ? settle(s, {
					...s,
					focusId: sib[i + 1]
				}) : step(1);
				case "ArrowLeft": return i > 0 ? settle(s, {
					...s,
					focusId: sib[i - 1]
				}) : step(-1);
				case "Enter": return step(1);
				case "Escape": return step(-1);
				case "ArrowDown": {
					const kid = (ix.children.get(f) ?? [])[0];
					return kid && (s.expanded[f] ?? 0) > 0 ? settle(s, {
						...s,
						focusId: kid
					}) : s;
				}
				case "ArrowUp": {
					const p = ix.parent.get(f) ?? null;
					return p === null ? s : settle(s, {
						...s,
						focusId: p
					});
				}
				default: return s;
			}
		}
	}
}
/** One detent of the tree button's drag: about the button's width. */
const TREE_DETENT_PX = 40;
/** How many cells a single drag can reach each way. */
const TREE_DRAG_CELLS = 6;
/** The tree drag's feel: the card swipe's snap and hysteresis (detent.ts). */
const TREE_HYSTERESIS = .1;
const TREE_SNAP = .6;
const TREE_STRETCH = .3;
/** Cells of a horizontal drag `dx`, from the cells it was at (hysteresis). */
function dragCells(dx, from) {
	return detentLevel(dx / TREE_DETENT_PX, from, {
		min: -TREE_DRAG_CELLS,
		max: TREE_DRAG_CELLS,
		hysteresis: TREE_HYSTERESIS
	});
}
/**
* Where the tree button's preview sits for a drag `dx`: snapping to the
* detents, and past a limit only rubber-banding (STRETCH of the travel
* beyond `limitCells`), released back to the detent.
*/
function dragOffset(dx, limitCells) {
	const feel = {
		cell: TREE_DETENT_PX,
		unit: TREE_DETENT_PX,
		max: TREE_DRAG_CELLS,
		snap: TREE_SNAP,
		stretch: TREE_STRETCH,
		stop: TREE_DRAG_CELLS * TREE_DETENT_PX
	};
	if (limitCells === void 0) return snapDetent(dx, feel);
	const edge = limitCells * TREE_DETENT_PX;
	const past = dx - edge;
	if (Math.sign(past) !== Math.sign(limitCells || dx) || past === 0) return snapDetent(dx, feel);
	return snapDetent(edge, feel) + past * TREE_STRETCH;
}

//#endregion
//#region src/float-lines.ts
/**
* The minimized chat's floating lines: a message that arrives while the chat is
* minimized floats above the bar for as long as it takes to read it twice,
* then fades. Hovering or touching the lines pauses their timers.
*/
/** Characters per second read in CJK scripts (Han, kana, Hangul). */
const READ_RATE_CJK = 6;
/** Characters per second for everything else (~180 words per minute). */
const READ_RATE_LATIN = 15;
/** A line stays up for this many reading times... */
const DWELL_FACTOR = 2;
/** ...and never less than this. */
const DWELL_MIN_MS = 2500;
/** The slow fade-out once the dwell is over (gone at once under reduced motion). */
const FADE_MS = 1e4;
/** At most this many lines float at once; the oldest goes first. */
const FLOAT_MAX = 6;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** Seconds to read `text` once: CJK characters at 6/s, the rest at 15/s. */
function readTime(text) {
	let cjk = 0;
	let other = 0;
	for (const ch of text.trim()) if (CJK.test(ch)) cjk++;
	else other++;
	return cjk / READ_RATE_CJK + other / READ_RATE_LATIN;
}
/** How long a floating line stays before it fades, in ms. */
function dwellMs(text) {
	return Math.max(DWELL_MIN_MS, Math.round(readTime(text) * 1e3 * DWELL_FACTOR));
}
/**
* One line's countdown: a single setTimeout, stopped by `pause` and restarted
* by `resume` with the time that was left. Clock and timers are injected for
* tests.
*/
function createDwellTimer(d) {
	const now = d.now ?? (() => Date.now());
	const setTimer = d.setTimer ?? ((f, ms) => setTimeout(f, ms));
	const clearTimer = d.clearTimer ?? ((t) => clearTimeout(t));
	let left = d.ms;
	let started = now();
	let timer = null;
	let done = false;
	const start = () => {
		started = now();
		timer = setTimer(() => {
			timer = null;
			done = true;
			d.onDone();
		}, left);
	};
	start();
	return {
		pause() {
			if (timer === null || done) return;
			clearTimer(timer);
			timer = null;
			left = Math.max(0, left - (now() - started));
		},
		resume() {
			if (timer !== null || done) return;
			start();
		},
		cancel() {
			if (timer !== null) clearTimer(timer);
			timer = null;
			done = true;
		},
		remaining: () => timer === null ? left : Math.max(0, left - (now() - started))
	};
}
/** The latest message floats on minimize only if it arrived at most this long ago. */
const MINIMIZE_FLOAT_MAX_AGE_MS = 10 * 6e4;
/**
* When this widget first saw each message, by id — this device's clock, never
* the message's own `at` (another clock, which may be skewed). New messages
* are told by id, not by the list's length: the host caps its history, so
* once full the list stays the same length as new lines push old ones out.
*/
function createArrivals() {
	const seen = /* @__PURE__ */ new Map();
	/** Arrival order, by id: 1, 2, 3… (never a clock, so never a tie). */
	const order = /* @__PURE__ */ new Map();
	let count = 0;
	let loaded = false;
	return {
		see(messages, now) {
			const fresh = messages.filter((m) => !seen.has(m.id));
			for (const m of fresh) {
				seen.set(m.id, now);
				order.set(m.id, ++count);
			}
			const history = !loaded;
			if (messages.length) loaded = true;
			if (seen.size > 2 * messages.length + 100) {
				const ids = new Set(messages.map((m) => m.id));
				for (const id of seen.keys()) if (!ids.has(id)) {
					seen.delete(id);
					order.delete(id);
				}
			}
			return {
				fresh,
				history
			};
		},
		at: (id) => seen.get(id),
		seqOf: (id) => order.get(id),
		seq: () => count
	};
}
/**
* The minimized bar's unread badge: the agent's messages that arrived after
* `readSeq` (the arrival order when the chat was last open, or the history
* loaded). By arrival, not by list position: a capped list keeps its length.
*/
function countUnread(messages, seqOf, readSeq) {
	return messages.filter((m) => m.from === "agent" && (seqOf(m.id) ?? 0) > readSeq).length;
}
/**
* At the moment the chat is minimized, the latest message (from anyone) is
* treated as unread and floats, unless it arrived here more than
* MINIMIZE_FLOAT_MAX_AGE_MS ago. Its dwell starts then, not when it arrived.
*/
function minimizeFloat(messages, now, arrivedAt) {
	const last = messages.at(-1);
	if (!last) return null;
	const at = arrivedAt(last.id);
	return at !== void 0 && now - at <= MINIMIZE_FLOAT_MAX_AGE_MS ? last : null;
}
function createFloatLife(d) {
	const setTimer = d.setTimer ?? ((f, ms) => setTimeout(f, ms));
	const clearTimer = d.clearTimer ?? ((t) => clearTimeout(t));
	let phase = "dwell";
	let paused = false;
	let fade = null;
	const set = (p) => {
		phase = p;
		d.onPhase(p);
	};
	const startFade = () => {
		set("fade");
		fade = setTimer(() => {
			fade = null;
			set("gone");
		}, d.fadeMs ?? FADE_MS);
	};
	const dwell = createDwellTimer({
		ms: d.ms,
		onDone: () => d.reducedMotion ? set("gone") : startFade(),
		now: d.now,
		setTimer,
		clearTimer
	});
	const life = {
		pause() {
			if (paused) return;
			paused = true;
			if (phase === "dwell") dwell.pause();
			else if (phase === "fade") {
				clearTimer(fade);
				fade = null;
				set("held");
			}
		},
		resume() {
			if (!paused) return;
			paused = false;
			if (phase === "dwell") dwell.resume();
			else if (phase === "held") startFade();
		},
		cancel() {
			dwell.cancel();
			if (fade !== null) clearTimer(fade);
			fade = null;
		},
		phase: () => phase
	};
	if (d.paused) life.pause();
	return life;
}

//#endregion
//#region src/anchor.ts
const ANCHOR_GUTTER_PX = 8;
/** The bar's side of the screen, by its centre: thirds. */
function anchorSide(barLeft, barRight, vw) {
	const mid = (barLeft + barRight) / 2;
	return mid < vw / 3 ? "left" : mid > 2 * vw / 3 ? "right" : "center";
}
/** The box's left edge (viewport px) for its width, anchored to the bar and clamped. */
function placeBox(d) {
	const g = d.gutter ?? ANCHOR_GUTTER_PX;
	const side = anchorSide(d.barLeft, d.barRight, d.vw);
	const want = side === "left" ? d.barLeft : side === "right" ? d.barRight - d.boxWidth : (d.barLeft + d.barRight) / 2 - d.boxWidth / 2;
	const min = (d.insetLeft ?? 0) + g;
	const max = d.vw - (d.insetRight ?? 0) - g - d.boxWidth;
	return {
		side,
		left: Math.round(max < min ? min : Math.min(max, Math.max(min, want)))
	};
}

//#endregion
//#region src/frontier-view.ts
/**
* The minimized chat's frontier lines: the last thing done, what is in
* progress, and what comes next. The data comes from src/state-tree.ts
* (`frontier`); this file has only the small display rules, so they can be
* tested without a DOM.
*/
const FRONTIER_ROWS = [
	{
		key: "done",
		mark: "✓",
		label: "Last done"
	},
	{
		key: "doing",
		mark: "▶",
		label: "In progress"
	},
	{
		key: "next",
		mark: "›",
		label: "Next"
	}
];
/** Visible characters of an agent id at the line's end. */
const SHORT_ID_LEN = 6;
/** Longer than this, an "id" is more likely a token than a slug: hidden. */
const MAX_ID_LEN = 64;
/** How long a touch must rest on the id to show the full one. */
const LONG_PRESS_MS = 500;
/**
* The agent id to show, or null. Only agents have one shown, and only an
* opaque slug: anything that looks like a host, a path, a pid:port or a
* token (a dot, colon or slash, or over 64 characters) is dropped.
*/
function shownAgentId(a) {
	if (!a || a.type !== "agent" || !a.id) return null;
	const id = a.id.trim();
	if (!id || id.length > MAX_ID_LEN || /[.:/\\]/.test(id)) return null;
	return id;
}
/** The last SHORT_ID_LEN characters, for the line's end. */
const shortId = (id) => id.slice(-SHORT_ID_LEN);
/** The `〔N〕` after a group's summary; nothing for a single item. */
const countBadge = (n) => n && n > 1 ? `〔${n}〕` : "";
/**
* The bar's lines from state-tree.ts frontier(): a group as its summary (or,
* without one, its first item's title) and count, its items with breadcrumbs;
* one item as its title. Undefined when there is nothing to show.
*/
function frontierView(f) {
	const line = (e) => e && {
		text: e.count > 1 && e.summary ? e.summary : e.title,
		count: e.count,
		...e.assignee ? { assignee: e.assignee } : {},
		...e.count > 1 ? { items: e.items.map((it) => ({
			title: it.title,
			path: crumbs(it.path),
			...it.assignee ? { assignee: it.assignee } : {}
		})) } : {}
	};
	const out = {};
	const done = line(f.done);
	const doing = line(f.doing);
	const next = line(f.next);
	if (done) out.done = done;
	if (doing) out.doing = doing;
	if (next) out.next = next;
	return done || doing || next ? out : void 0;
}

//#endregion
//#region src/tap-gesture.ts
/**
* One tap or two (the chat box's grip): a single tap acts only once
* `delayMs` pass without a second; a second tap inside that window cancels it
* and acts as a double tap. Timers are injected for tests.
*/
const DOUBLE_TAP_MS = 280;
function createTapper(d) {
	const setTimer = d.setTimer ?? ((f, ms) => setTimeout(f, ms));
	const clearTimer = d.clearTimer ?? ((t) => clearTimeout(t));
	let waiting = null;
	return {
		tap() {
			if (waiting !== null) {
				clearTimer(waiting);
				waiting = null;
				return d.onDouble();
			}
			waiting = setTimer(() => {
				waiting = null;
				d.onSingle();
			}, d.delayMs ?? DOUBLE_TAP_MS);
		},
		cancel() {
			if (waiting !== null) clearTimer(waiting);
			waiting = null;
		}
	};
}
/** How long after a drag ends its click is still "the click that ended a drag". */
const DRAG_CLICK_MS = 400;
/**
* Tells the click that ends a drag from a real tap. The flag is cleared by
* the next pointerdown and expires after DRAG_CLICK_MS, so a browser that
* sends no click after a touch drag (iOS) never swallows the next tap.
*/
function createDragFlag(now = Date.now) {
	let endedAt = null;
	return {
		down() {
			endedAt = null;
		},
		dragEnded() {
			endedAt = now();
		},
		wasDrag() {
			const d = endedAt !== null && now() - endedAt < DRAG_CLICK_MS;
			endedAt = null;
			return d;
		}
	};
}
/** A press must move this far before it counts as a drag, and its axis is locked. */
const AXIS_LOCK_PX = 8;
/**
* One press on the mic, told apart by its first AXIS_LOCK_PX of movement:
* under that it stays a tap (the mic toggles); then it locks to an axis for
* the rest of the press — "y" scrubs the chat history, "x" moves the bar.
* `up` says whether the click that follows must be swallowed (any lock).
*/
function createAxisLock(lockPx = AXIS_LOCK_PX) {
	let start = null;
	let axis = null;
	return {
		down(x, y) {
			start = {
				x,
				y
			};
			axis = null;
		},
		move(x, y) {
			if (!start) return null;
			const dx = x - start.x;
			const dy = y - start.y;
			if (!axis) {
				if (Math.hypot(dx, dy) < lockPx) return null;
				axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
			}
			return {
				axis,
				dx,
				dy
			};
		},
		up() {
			const a = axis;
			start = null;
			axis = null;
			return a;
		},
		axis: () => axis
	};
}
/** Pixels of vertical drag per message line scrubbed. */
const SCRUB_STEP_PX = 28;
/**
* Where a scrub lands: `back` lines from the newest, from where it started and
* the finger's vertical travel. Finger down = older (as the expanded log's
* swipe: the content follows the finger), clamped to [0, max].
*/
function scrubBack(startBack, dy, max, step = SCRUB_STEP_PX) {
	return Math.max(0, Math.min(max, startBack + Math.trunc(dy / step)));
}
/**
* A press held for `ms` (500 by default) without moving off: `onLong` fires
* once. `down` starts it; `up` or `cancel` (the press ended or moved away)
* stops it. Timers are injected for tests.
*/
function createLongPress(d) {
	const setTimer = d.setTimer ?? ((f, ms) => setTimeout(f, ms));
	const clearTimer = d.clearTimer ?? ((t) => clearTimeout(t));
	let t = null;
	let fired = false;
	const stop = () => {
		if (t !== null) clearTimer(t);
		t = null;
	};
	return {
		down() {
			stop();
			fired = false;
			t = setTimer(() => {
				t = null;
				fired = true;
				d.onLong();
			}, d.ms ?? 500);
		},
		up() {
			stop();
			return fired;
		},
		cancel: stop
	};
}

//#endregion
//#region src/scroll-handoff.ts
/** A finger moving less than this is still a tap (the caret goes where it lands). */
const SWIPE_SLOP_PX = 6;
/** One wheel "line" (deltaMode 1, as Firefox reports a mouse wheel), in pixels. */
const WHEEL_LINE_PX = 16;
/** Less than this left to scroll counts as none (fractional scrollTop on zoomed pages). */
const EPS = 1;
/** How far `el` can scroll down (positive) and up (negative) from where it is. */
function scrollRoom(el) {
	const max = Math.max(0, el.scrollHeight - el.clientHeight);
	const top = Math.min(max, Math.max(0, el.scrollTop));
	const down = max - top;
	return {
		up: top < EPS ? 0 : top,
		down: down < EPS ? 0 : down
	};
}
/**
* Split one scroll delta between the input and the log: the input takes what
* it has room for in that direction, and the log the rest.
*/
function splitScroll(input, delta) {
	if (!Number.isFinite(delta) || delta === 0) return {
		inputDelta: 0,
		logDelta: 0
	};
	const room = scrollRoom(input);
	const inputDelta = (delta > 0 ? Math.min(delta, room.down) : Math.max(delta, -room.up)) + 0;
	return {
		inputDelta,
		logDelta: delta - inputDelta + 0
	};
}
/** A wheel event's vertical delta in pixels (deltaMode 0 pixels, 1 lines, 2 pages). */
function wheelPixels(deltaY, deltaMode, pagePx) {
	if (deltaMode === 1) return deltaY * WHEEL_LINE_PX;
	if (deltaMode === 2) return deltaY * pagePx;
	return deltaY;
}
/**
* One touch gesture over the input, move by move. Until the finger leaves
* SWIPE_SLOP_PX it is a tap and nothing scrolls. Then each move is split:
* while the input scrolls natively the box leaves it alone (no
* preventDefault) and adds only the log's share; once a move had to be
* cancelled (nothing for the input), the box drives both for the rest of the
* gesture, since the browser no longer scrolls the input by itself then.
*/
function createSwipeHandoff() {
	let y = 0;
	let swiping = false;
	let owned = false;
	return {
		start(clientY) {
			y = clientY;
			swiping = false;
			owned = false;
		},
		move(input, clientY, cancelable) {
			if (!swiping && Math.abs(clientY - y) < SWIPE_SLOP_PX) return null;
			swiping = true;
			const delta = y - clientY;
			y = clientY;
			const { inputDelta, logDelta } = splitScroll(input, delta);
			if (!owned && inputDelta === 0 && cancelable) owned = true;
			if (owned) return {
				inputDelta,
				logDelta,
				prevent: cancelable
			};
			return {
				inputDelta: 0,
				logDelta,
				prevent: false
			};
		}
	};
}

//#endregion
//#region src/ui-strings.ts
const UI_EN = {
	stateTree: "State tree",
	closeTree: "Close the state tree",
	noTreeSource: "No tree source",
	lastDone: "Last done",
	nowDoing: "In progress",
	upNext: "Next",
	needsYou: "needs you",
	items: "items",
	polished: "Polished",
	attachOpen: "Add or attach",
	attachRemove: "Remove the attachment",
	attachQuoted: "Quoted from the page",
	attachFile: "File",
	attachDrop: "Drop to attach",
	attachUploading: "Uploading…",
	attachFailed: "Upload failed",
	attachTooBig: "Too large",
	attachFileRemove: "Remove this file",
	files: "Files",
	filesEmpty: "Nothing here yet.",
	filesUsage: "{size} stored · {n} files",
	filesUsageQuota: "{size} of {quota} used · {n} files",
	filesFailed: "Could not load the files.",
	filesProcessed: "Processed",
	filesDelete: "Delete",
	filesDeleteConfirm: "Delete for good?",
	filesKeep: "Keep",
	filesClose: "Close the files",
	echoOn: "Echo cancellation on",
	echoOff: "Echo cancellation off",
	hintType: "Type here; it is sent {s} s after you stop.",
	dragHint: "drag: move · tap: minimize · double-tap: menu",
	messageNode: "Message {node}…",
	messageAgent: "Message the agent…",
	messageAgentLabel: "Message the agent",
	chatWithAgent: "Chat with the agent",
	markHint: "Tap: minimize or restore · double-tap: menu · drag: move the chat",
	treeHint: "Tap: show or hide the state tree · drag right: open the focused node deeper · drag left: fold it · arrow keys: move",
	agentOfflineWaits: "Agent offline — your message waits for it…",
	asksLabel: "Agent connections",
	nodesLabel: "Nodes to address",
	toMainThread: "Send to the main thread instead",
	statusUnavailable: "chat unavailable",
	statusNotConnected: "not connected — your draft is kept",
	statusReconnecting: "reconnecting…",
	statusListening: "agent listening ({n})",
	statusAgentOffline: "agent offline · messages wait until it is back",
	agentWorking: "the agent is working",
	askWhereAll: "on all your pages, including pages opened later,",
	askWhereChosen: "on the chosen pages",
	askFriend: "to run code {where} for 1 hour",
	askEval: "to run code {where} and chat, for 8 hours",
	askChat: "to chat with you, for 30 days",
	askOld: "to run code on your pages, or to chat",
	askSentence: "{label} asks {what}. Allow only if the agent shows the same code: {code}.",
	tagCode1h: "code · 1h",
	tagCode8h: "code · 8h",
	tagChat30d: "chat · 30d",
	allow: "Allow",
	allowAllTitle: "Allow on all your pages, including pages opened later",
	allowTickedTitle: "Allow on the ticked pages",
	allow8h: "8h",
	allow8hAllTitle: "Allow code on all your pages and chat, for 8 hours",
	allow8hTitle: "Allow code and chat for 8 hours",
	chatOnly: "chat",
	chatOnlyTitle: "Chat only, for 30 days",
	deny: "Deny",
	pagesAllLater: "all pages, and pages opened later",
	thisPage: " (this page)",
	you: "you",
	agentName: "agent",
	speedLabel: "Reading speed",
	speed: "Speed",
	readAloudMic: "Replies read aloud (mic on)",
	readAloud: "Replies read aloud",
	silent: "Replies silent",
	minimize: "–  Minimize",
	restore: "+  Restore",
	minimizeChat: "Minimize chat",
	restoreChat: "Restore chat",
	restoreChatNew: "Restore chat, {n} new",
	sessChat: "chat",
	sessPreview: "preview",
	sessEval: "eval",
	allPages: "all pages",
	pagesOne: "1 page",
	pagesN: "{n} pages",
	end: "End",
	openPages: "Your open pages",
	endThisPage: "End this page?"
};
const UI_ZH = {
	stateTree: "状态树",
	closeTree: "关闭状态树",
	noTreeSource: "没有状态树来源",
	lastDone: "最近完成",
	nowDoing: "进行中",
	upNext: "下一步",
	needsYou: "等你处理",
	items: "项",
	polished: "已润色",
	attachOpen: "添加或附加",
	attachRemove: "移除附件",
	attachQuoted: "引用自页面",
	attachFile: "文件",
	attachDrop: "松手即可附加",
	attachUploading: "上传中…",
	attachFailed: "上传失败",
	attachTooBig: "文件过大",
	attachFileRemove: "移除此文件",
	files: "文件",
	filesEmpty: "这里还没有文件。",
	filesUsage: "已存 {size} · {n} 个文件",
	filesUsageQuota: "已用 {size} / {quota} · {n} 个文件",
	filesFailed: "无法加载文件列表。",
	filesProcessed: "已处理",
	filesDelete: "删除",
	filesDeleteConfirm: "永久删除？",
	filesKeep: "保留",
	filesClose: "关闭文件列表",
	echoOn: "回声消除：开",
	echoOff: "回声消除：关",
	hintType: "在这里输入，停止输入 {s} 秒后自动发送。",
	dragHint: "拖动：移动 · 轻点：最小化 · 双击：菜单",
	messageNode: "发给 {node}…",
	messageAgent: "给 agent 发消息…",
	messageAgentLabel: "给 agent 发消息",
	chatWithAgent: "与 agent 聊天",
	markHint: "轻点：最小化或还原 · 双击：菜单 · 拖动：移动聊天框",
	treeHint: "轻点：显示或隐藏状态树 · 向右拖：展开当前节点 · 向左拖：折叠 · 方向键：移动",
	agentOfflineWaits: "agent 离线，消息会等它回来…",
	asksLabel: "agent 连接",
	nodesLabel: "可发送的节点",
	toMainThread: "改发到主线程",
	statusUnavailable: "聊天不可用",
	statusNotConnected: "未连接，草稿已保留",
	statusReconnecting: "重新连接中…",
	statusListening: "agent 在听（{n}）",
	statusAgentOffline: "agent 离线 · 消息会等它回来",
	agentWorking: "agent 正在工作",
	askWhereAll: "在你所有页面（包括之后打开的）上",
	askWhereChosen: "在选中的页面上",
	askFriend: "{where}运行代码，1 小时",
	askEval: "{where}运行代码并聊天，8 小时",
	askChat: "和你聊天，30 天",
	askOld: "在你的页面上运行代码，或聊天",
	askSentence: "{label} 请求{what}。只有 agent 显示同样的代码 {code} 时才允许。",
	tagCode1h: "代码 · 1 小时",
	tagCode8h: "代码 · 8 小时",
	tagChat30d: "聊天 · 30 天",
	allow: "允许",
	allowAllTitle: "在你所有页面上允许（包括之后打开的）",
	allowTickedTitle: "在勾选的页面上允许",
	allow8h: "8 小时",
	allow8hAllTitle: "在你所有页面上允许代码和聊天，8 小时",
	allow8hTitle: "允许代码和聊天，8 小时",
	chatOnly: "聊天",
	chatOnlyTitle: "只聊天，30 天",
	deny: "拒绝",
	pagesAllLater: "所有页面，以及之后打开的页面",
	thisPage: "（本页）",
	you: "你",
	agentName: "agent",
	speedLabel: "朗读速度",
	speed: "语速",
	readAloudMic: "朗读回复（麦克风开着）",
	readAloud: "朗读回复",
	silent: "不朗读回复",
	minimize: "–  最小化",
	restore: "+  还原",
	minimizeChat: "最小化聊天",
	restoreChat: "还原聊天",
	restoreChatNew: "还原聊天，{n} 条新消息",
	sessChat: "聊天",
	sessPreview: "预览",
	sessEval: "eval",
	allPages: "所有页面",
	pagesOne: "1 个页面",
	pagesN: "{n} 个页面",
	end: "结束",
	openPages: "你打开的页面",
	endThisPage: "结束本页？"
};
/** The tree's strings in Chinese (tree.ts TreeStrings). */
const TREE_ZH = {
	tree: "状态树",
	back: "返回聊天",
	needsMe: "待我处理",
	needsYou: "等你处理",
	openCount: "{n} 项未完成",
	needsYouCount: "{n} 项等你",
	copy: "复制",
	copied: "已复制",
	loading: "加载中…",
	failed: "无法加载状态树",
	empty: "状态树是空的。",
	nothingNeedsYou: "没有等你处理的事。",
	you: "你",
	lastDone: "最近完成",
	nowDoing: "进行中",
	upNext: "下一步",
	live: "实时数据"
};
/** The box's strings in Japanese, picked on a ja page (taku 11-09: a Japanese UI shows Japanese). */
const UI_JA = {
	stateTree: "状態ツリー",
	closeTree: "状態ツリーを閉じる",
	noTreeSource: "ツリーのソースがありません",
	lastDone: "直近の完了",
	nowDoing: "進行中",
	upNext: "次",
	needsYou: "あなた待ち",
	items: "件",
	polished: "整えました",
	attachOpen: "追加・添付",
	attachRemove: "添付を外す",
	attachQuoted: "ページからの引用",
	attachFile: "ファイル",
	attachDrop: "ドロップして添付",
	attachUploading: "アップロード中…",
	attachFailed: "アップロードに失敗しました",
	attachTooBig: "大きすぎます",
	attachFileRemove: "このファイルを外す",
	files: "ファイル",
	filesEmpty: "まだ何もありません。",
	filesUsage: "{size} 保存済み · {n} 件",
	filesUsageQuota: "{quota} 中 {size} 使用 · {n} 件",
	filesFailed: "ファイルを読み込めませんでした。",
	filesProcessed: "処理済み",
	filesDelete: "削除",
	filesDeleteConfirm: "完全に削除しますか？",
	filesKeep: "残す",
	filesClose: "ファイルを閉じる",
	echoOn: "エコーキャンセル：オン",
	echoOff: "エコーキャンセル：オフ",
	hintType: "ここに入力すると、入力をやめて {s} 秒後に送信されます。",
	dragHint: "ドラッグ：移動 · タップ：最小化 · ダブルタップ：メニュー",
	messageNode: "{node} にメッセージ…",
	messageAgent: "エージェントにメッセージ…",
	messageAgentLabel: "エージェントにメッセージ",
	chatWithAgent: "エージェントとチャット",
	markHint: "タップ：最小化・元に戻す · ダブルタップ：メニュー · ドラッグ：チャットを移動",
	treeHint: "タップ：状態ツリーの表示・非表示 · 右へドラッグ：選択中のノードを開く · 左へドラッグ：たたむ · 矢印キー：移動",
	agentOfflineWaits: "エージェントはオフライン — メッセージは戻るまで待ちます…",
	asksLabel: "エージェントの接続",
	nodesLabel: "宛先のノード",
	toMainThread: "代わりにメインスレッドへ送る",
	statusUnavailable: "チャットを使えません",
	statusNotConnected: "未接続 — 下書きは残っています",
	statusReconnecting: "再接続中…",
	statusListening: "エージェント待機中（{n}）",
	statusAgentOffline: "エージェントはオフライン · 戻るまでメッセージは待ちます",
	agentWorking: "エージェントが作業中",
	askWhereAll: "すべてのページ（後で開くページを含む）で",
	askWhereChosen: "選んだページで",
	askFriend: "{where}1 時間コードを実行すること",
	askEval: "{where}8 時間コードの実行とチャットをすること",
	askChat: "30 日間あなたとチャットすること",
	askOld: "ページでのコード実行、またはチャット",
	askSentence: "{label} が {what} を求めています。エージェントが同じコード {code} を示しているときだけ許可してください。",
	tagCode1h: "コード · 1時間",
	tagCode8h: "コード · 8時間",
	tagChat30d: "チャット · 30日",
	allow: "許可",
	allowAllTitle: "すべてのページ（後で開くページを含む）で許可",
	allowTickedTitle: "チェックしたページで許可",
	allow8h: "8時間",
	allow8hAllTitle: "すべてのページでのコードとチャットを 8 時間許可",
	allow8hTitle: "コードとチャットを 8 時間許可",
	chatOnly: "チャット",
	chatOnlyTitle: "チャットのみ、30 日間",
	deny: "拒否",
	pagesAllLater: "すべてのページと後で開くページ",
	thisPage: "（このページ）",
	you: "あなた",
	agentName: "エージェント",
	speedLabel: "読み上げ速度",
	speed: "速度",
	readAloudMic: "返信を読み上げ（マイク オン）",
	readAloud: "返信を読み上げ",
	silent: "返信を読み上げない",
	minimize: "–  最小化",
	restore: "+  元に戻す",
	minimizeChat: "チャットを最小化",
	restoreChat: "チャットを元に戻す",
	restoreChatNew: "チャットを元に戻す（新着 {n} 件）",
	sessChat: "チャット",
	sessPreview: "プレビュー",
	sessEval: "eval",
	allPages: "すべてのページ",
	pagesOne: "1 ページ",
	pagesN: "{n} ページ",
	end: "終了",
	openPages: "開いているページ",
	endThisPage: "このページを終了しますか？"
};
/** The tree's strings in Japanese. */
const TREE_JA = {
	tree: "状態ツリー",
	back: "チャットに戻る",
	needsMe: "自分の対応待ち",
	needsYou: "あなた待ち",
	openCount: "未完了 {n} 件",
	needsYouCount: "あなた待ち {n} 件",
	copy: "コピー",
	copied: "コピーしました",
	loading: "読み込み中…",
	failed: "状態ツリーを読み込めません",
	empty: "状態ツリーは空です。",
	nothingNeedsYou: "あなた待ちのものはありません。",
	you: "あなた",
	lastDone: "直近の完了",
	nowDoing: "進行中",
	upNext: "次",
	live: "ライブデータ"
};
/** The page's language is Japanese. */
function isJa(lang = globalThis.document?.documentElement.lang) {
	return /^ja\b/i.test(lang ?? "");
}
/** The page's language is Chinese. */
function isZh(lang = globalThis.document?.documentElement.lang) {
	return /^zh\b/i.test(lang ?? "");
}
/** The box's strings for the page's language. */
const uiStrings = (lang) => isZh(lang) ? UI_ZH : isJa(lang) ? UI_JA : UI_EN;
/** The tree's defaults for the page's language, under the host's own. */
const treeDefaults = (lang) => isZh(lang) ? TREE_ZH : isJa(lang) ? TREE_JA : {};

//#endregion
//#region src/speak-rules.ts
/** Quiet: `say --quiet`. Only boolean true counts. */
const isQuiet = (m) => m.quiet === true;
/** The rules: a quiet line, then a hidden page. */
function silenceFor(m, at) {
	if (isQuiet(m)) return "quiet";
	if (at.hidden) return "hidden";
	return null;
}
/** The page is hidden or the screen is locked (true without a document: never speak there). */
const pageHidden = () => typeof document === "undefined" || document.visibilityState === "hidden";
/**
* Per-device setting names an older version saved (under the box's
* storage-key) that mean nothing now. The box removes them when it attaches.
*/
const RETIRED_SETTINGS = ["quiet-hours"];

//#endregion
export { readTime as $, LONG_PRESS_MS as A, oneLine as At, DWELL_FACTOR as B, SCRUB_STEP_PX as C, actionEnabled as Ct, createTapper as D, isSensitive as Dt, createLongPress as E, fileAction as Et, shortId as F, READ_RATE_CJK as G, FADE_MS as H, shownAgentId as I, createArrivals as J, READ_RATE_LATIN as K, ANCHOR_GUTTER_PX as L, SHORT_ID_LEN as M, readSelection as Mt, countBadge as N, selectionAction as Nt, scrubBack as O, mediaAction as Ot, frontierView as P, minimizeFloat as Q, anchorSide as R, DRAG_CLICK_MS as S, SENSITIVE as St, createDragFlag as T, createSelectionMemory as Tt, FLOAT_MAX as U, DWELL_MIN_MS as V, MINIMIZE_FLOAT_MAX_AGE_MS as W, createFloatLife as X, createDwellTimer as Y, dwellMs as Z, scrollRoom as _, atEndAfter as _t, TREE_JA as a, TREE_STRETCH as at, AXIS_LOCK_PX as b, CHAT_FENCE as bt, UI_JA as c, height as ct, isZh as d, isVisible as dt, MAX_DETENT as et, treeDefaults as f, maxDetent as ft, createSwipeHandoff as g, END_SLACK_PX as gt, WHEEL_LINE_PX as h, snapDetent as ht, silenceFor as i, TREE_SNAP as it, MAX_ID_LEN as j, pageSelection as jt, FRONTIER_ROWS as k, menuGroups as kt, UI_ZH as l, indexTree as lt, SWIPE_SLOP_PX as m, detentLevel as mt, isQuiet as n, TREE_DRAG_CELLS as nt, TREE_ZH as o, dragCells as ot, uiStrings as p, treeNav as pt, countUnread as q, pageHidden as r, TREE_HYSTERESIS as rt, UI_EN as s, dragOffset as st, RETIRED_SETTINGS as t, TREE_DETENT_PX as tt, isJa as u, initialNav as ut, splitScroll as v, repinEnd as vt, createAxisLock as w, actionsAt as wt, DOUBLE_TAP_MS as x, SELECTION_TTL_MS as xt, wheelPixels as y, stillAtEnd as yt, placeBox as z };
//# sourceMappingURL=speak-rules-CHlO4ux7.js.map