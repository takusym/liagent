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
export { silenceFor as i, isQuiet as n, pageHidden as r, RETIRED_SETTINGS as t };
//# sourceMappingURL=speak-rules-CuM1k5aH.js.map