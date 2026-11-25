//#region src/input.ts
/** Typing pauses this long before the draft is sent. */
const DEBOUNCE_MS = 3e3;
/** A burst this long or longer (dictation) that ends a sentence sends at once. */
const BURST_CHARS = 10;
const ENDS_SENTENCE = /[。．.!?！？]$/;
/** An Enter keydown that sends: not Shift+Enter, not inside or confirming an IME composition. */
function enterSends(e, composing) {
	if (e.key !== "Enter" || e.shiftKey) return false;
	return !(e.isComposing || composing || e.keyCode === 229);
}
/** A beforeinput line break that sends (Android): not Shift+Enter, not composing. */
function lineBreakSends(inputType, opts) {
	if (inputType !== "insertLineBreak" && inputType !== "insertParagraph") return false;
	return !(opts.composing || opts.isComposing || opts.shiftEnter);
}
/**
* What the draft change does once the box's holds apply: a mic that is on, a
* live partial, or an explicit hold stop both the jump-send and the debounce.
*/
function autoSend(next, held) {
	return held.mic || held.partial || held.hold ? "idle" : next;
}
/**
* After the draft changed outside a composition: "send" now (a dictated
* sentence), "arm" the debounce, or "idle" (nothing to send). `settledLen` is
* the draft's length at the previous settled change.
*/
function afterChange(text, settledLen, composing) {
	if (composing) return "idle";
	if (text.length - settledLen > BURST_CHARS && ENDS_SENTENCE.test(text.trim())) return "send";
	return text.trim() ? "arm" : "idle";
}
const CJK_START = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;
const CJK_END = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]$/u;
/**
* What a live (not yet final) transcript adds after the draft, as shown
* dimmed in the input: a space between two words, none after a space or a
* line break, or next to CJK text. Empty for no partial.
*/
function partialTail(draft, partial) {
	const p = (partial ?? "").trim();
	if (!p) return "";
	if (!draft || /\s$/.test(draft) || CJK_END.test(draft) || CJK_START.test(p)) return p;
	return ` ${p}`;
}

//#endregion
export { autoSend as a, partialTail as c, afterChange as i, DEBOUNCE_MS as n, enterSends as o, ENDS_SENTENCE as r, lineBreakSends as s, BURST_CHARS as t };
//# sourceMappingURL=input-BEw-AxAo.js.map