import { MAX_CHAT } from "./protocol.js";
import { i as afterChange, n as DEBOUNCE_MS, o as enterSends, s as lineBreakSends } from "./input-BEw-AxAo.js";

//#region src/draft.ts
function createDraft(opts) {
	const now = opts.now ?? Date.now;
	const later = opts.setTimeout ?? ((f, ms) => setTimeout(f, ms));
	const cancel = opts.clearTimeout ?? ((t) => clearTimeout(t));
	let state = Object.freeze({
		text: "",
		composing: false,
		armedUntil: null,
		failed: false
	});
	const subs = /* @__PURE__ */ new Set();
	let timer;
	let settledLen = 0;
	let shiftEnter = false;
	const commit = (p) => {
		const next = {
			...state,
			...p
		};
		if (Object.keys(p).every((k) => Object.is(state[k], next[k]))) return;
		state = Object.freeze(next);
		for (const f of subs) f(state);
	};
	const disarm = () => {
		cancel(timer);
		timer = void 0;
		commit({ armedUntil: null });
	};
	const submit = () => {
		disarm();
		const text = state.text.trim();
		if (!text) return false;
		if (!opts.send(text)) {
			commit({ failed: true });
			return false;
		}
		settledLen = 0;
		commit({
			text: "",
			failed: false
		});
		return true;
	};
	const arm = () => {
		disarm();
		const next = afterChange(state.text, settledLen, state.composing);
		if (!state.composing) settledLen = state.text.length;
		if (next === "send") return void submit();
		if (next === "idle" || opts.hold?.()) return;
		timer = later(submit, DEBOUNCE_MS);
		commit({ armedUntil: now() + DEBOUNCE_MS });
	};
	return {
		getState: () => state,
		subscribe(fn) {
			subs.add(fn);
			return () => void subs.delete(fn);
		},
		input(text) {
			commit({
				text: String(text ?? "").slice(0, MAX_CHAT),
				failed: false
			});
			arm();
		},
		compositionStart() {
			commit({ composing: true });
			disarm();
		},
		compositionEnd() {
			commit({ composing: false });
			arm();
		},
		keydown(e) {
			shiftEnter = e.key === "Enter" && e.shiftKey;
			if (!enterSends(e, state.composing)) return false;
			submit();
			return true;
		},
		beforeInput(e) {
			const sends = lineBreakSends(e.inputType, {
				composing: state.composing,
				isComposing: e.isComposing,
				shiftEnter
			});
			if (sends) submit();
			return sends;
		},
		submit,
		set(text) {
			const t = String(text ?? "").slice(0, MAX_CHAT);
			settledLen = t.length;
			commit({
				text: t,
				failed: false
			});
			arm();
		},
		dispose: disarm
	};
}
/**
* Wire a <textarea> (or <input>) to a draft: its events in, and its value
* cleared when the line goes out. Returns unbind.
*/
function bindDraft(el, draft) {
	const on = [
		["input", () => draft.input(el.value)],
		["compositionstart", () => draft.compositionStart()],
		["compositionend", () => draft.compositionEnd()],
		["keydown", (e) => {
			if (draft.keydown(e)) e.preventDefault();
		}],
		["beforeinput", (e) => {
			if (draft.beforeInput(e)) e.preventDefault();
		}]
	];
	for (const [t, f] of on) el.addEventListener(t, f);
	const unsub = draft.subscribe((s) => {
		if (el.value !== s.text) el.value = s.text;
	});
	return () => {
		unsub();
		for (const [t, f] of on) el.removeEventListener(t, f);
	};
}

//#endregion
export { createDraft as n, bindDraft as t };
//# sourceMappingURL=draft-C7hAOcBf.js.map