import { i as createChat, r as connectVoice } from "./core-DxJBon4x.js";
import { hubTransport } from "./client.js";
import { n as createDraft, t as bindDraft } from "./draft-C7hAOcBf.js";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

//#region src/react.ts
const whole = (s) => s;
function useChatState(chat, select) {
	const pick = select ?? whole;
	const get = () => pick(chat.getState());
	return useSyncExternalStore(chat.subscribe, get, get);
}
/** A chat on the hub's page socket, for this component's life. */
function useHubChat(opts) {
	const latest = useRef(opts);
	latest.current = opts;
	const { url, evalCode, trackPages, requireActivation } = opts;
	const chat = useMemo(() => createChat({
		requireActivation,
		transport: hubTransport({
			url,
			evalCode,
			trackPages,
			label: () => {
				const l = latest.current.label;
				return typeof l === "function" ? l() : l ?? defaultLabel();
			},
			wanted: () => latest.current.wanted?.() ?? true,
			onEval: (r) => latest.current.onEval?.(r)
		})
	}), [
		url,
		evalCode,
		trackPages,
		requireActivation
	]);
	useEffect(() => {
		chat.start();
		return () => chat.stop();
	}, [chat]);
	const voice = opts.voice;
	useEffect(() => voice ? connectVoice(chat, voice) : void 0, [chat, voice]);
	return chat;
}
/** hubTransport's own default label, for when the host gives none. */
function defaultLabel() {
	const standalone = matchMedia?.("(display-mode: standalone)").matches ? "pwa " : "";
	return `${location.pathname} ${standalone}${navigator.userAgent}`;
}
/**
* The draft for `chat` (src/draft.ts): its state, the controller, and a ref
* that wires a <textarea> or <input> to it.
*/
function useDraft(chat, opts = {}) {
	const latest = useRef(opts);
	latest.current = opts;
	const draft = useMemo(() => createDraft({
		send: (text) => chat.send(text, { to: latest.current.to }),
		hold: () => latest.current.hold?.() ?? false
	}), [chat]);
	useEffect(() => () => draft.dispose(), [draft]);
	const state = useSyncExternalStore(draft.subscribe, draft.getState, draft.getState);
	const unbind = useRef(null);
	return {
		state,
		draft,
		ref: useCallback((el) => {
			unbind.current?.();
			unbind.current = el ? bindDraft(el, draft) : null;
		}, [draft])
	};
}

//#endregion
export { useChatState, useDraft, useHubChat };
//# sourceMappingURL=react.js.map