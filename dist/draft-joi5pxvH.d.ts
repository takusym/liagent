//#region src/input.d.ts
/** Typing pauses this long before the draft is sent. */
declare const DEBOUNCE_MS = 3000;
/** A burst this long or longer (dictation) that ends a sentence sends at once. */
declare const BURST_CHARS = 10;
declare const ENDS_SENTENCE: RegExp;
type KeyInfo = {
  key: string;
  shiftKey: boolean;
  keyCode?: number;
  isComposing?: boolean;
};
/** An Enter keydown that sends: not Shift+Enter, not inside or confirming an IME composition. */
declare function enterSends(e: KeyInfo, composing: boolean): boolean;
/** A beforeinput line break that sends (Android): not Shift+Enter, not composing. */
declare function lineBreakSends(inputType: string, opts: {
  composing: boolean;
  isComposing?: boolean;
  shiftEnter: boolean;
}): boolean;
/**
 * After the draft changed outside a composition: "send" now (a dictated
 * sentence), "arm" the debounce, or "idle" (nothing to send). `settledLen` is
 * the draft's length at the previous settled change.
 */
declare function afterChange(text: string, settledLen: number, composing: boolean): "send" | "arm" | "idle";
//#endregion
//#region src/draft.d.ts
type DraftState = Readonly<{
  text: string;
  composing: boolean; /** When the debounce sends it (the clock's time), or null if nothing is armed. */
  armedUntil: number | null; /** The last try to send it failed: it is kept. */
  failed: boolean;
}>;
type DraftOptions = {
  /** Send the line; false if it could not go out (the draft is kept). */send: (text: string) => boolean; /** True while nothing should go out by itself (only Enter or submit() sends). */
  hold?: () => boolean;
  now?: () => number;
  setTimeout?: (f: () => void, ms: number) => unknown;
  clearTimeout?: (t: unknown) => void;
};
type Draft = {
  getState(): DraftState;
  subscribe(fn: (s: DraftState) => void): () => void; /** The input's text changed (an input event). */
  input(text: string): void;
  compositionStart(): void;
  compositionEnd(): void; /** A keydown; true if it sent the draft (call preventDefault). */
  keydown(e: KeyInfo): boolean; /** A beforeinput; true if it sent the draft (call preventDefault). */
  beforeInput(e: {
    inputType: string;
    isComposing?: boolean;
  }): boolean; /** Send now, as Enter would; true if it went out. */
  submit(): boolean; /** Replace the text without sending (no burst). */
  set(text: string): void; /** Drop any armed send. */
  dispose(): void;
};
declare function createDraft(opts: DraftOptions): Draft;
type TextInput = {
  value: string;
  addEventListener(type: string, f: (e: Event) => void): void;
  removeEventListener(type: string, f: (e: Event) => void): void;
};
/**
 * Wire a <textarea> (or <input>) to a draft: its events in, and its value
 * cleared when the line goes out. Returns unbind.
 */
declare function bindDraft(el: TextInput, draft: Draft): () => void;
//#endregion
export { createDraft as a, ENDS_SENTENCE as c, enterSends as d, lineBreakSends as f, bindDraft as i, KeyInfo as l, DraftOptions as n, BURST_CHARS as o, DraftState as r, DEBOUNCE_MS as s, Draft as t, afterChange as u };
//# sourceMappingURL=draft-joi5pxvH.d.ts.map