//#region src/format.ts
/** A page's label is "<path> <user agent>": the path and a short device hint. */
function pageHint(label) {
	const [path = "", ...rest] = label.split(" ");
	const ua = rest.join(" ");
	const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh|Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux|X11/.test(ua) ? "Linux" : ua.split(" ").find((w) => w !== "pwa") ?? "";
	const pwa = /(^| )pwa( |$)/.test(ua) ? " app" : "";
	return device ? `${path} · ${device}${pwa}` : path;
}
const pad = (n) => String(n).padStart(2, "0");
/** HH:MM:SS today, YYYY-MM-DD HH:MM before — local time, ISO order. */
function when(at, now = /* @__PURE__ */ new Date()) {
	const d = new Date(at);
	const day = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
	const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	return day(d) === day(now) ? `${hm}:${pad(d.getSeconds())}` : `${day(d)} ${hm}`;
}

//#endregion
//#region src/avatar.ts
/** A short, stable hash (FNV-1a, 32 bits, base 36). */
function hashId(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36);
}
/** The URLs in an AvatarSrc, in order, empty ones dropped. */
function avatarSrcs(src) {
	if (typeof src === "string") return src ? [src] : [];
	if (Array.isArray(src)) return src.filter((u) => typeof u === "string" && !!u);
	return [];
}
/** The fallback's letter: the name's first grapheme, upper-cased; "?" for none. */
function initialOf(name) {
	const s = (name ?? "").trim();
	if (!s) return "?";
	const Seg = Intl.Segmenter;
	return ((Seg ? new Seg(void 0, { granularity: "grapheme" }).segment(s)[Symbol.iterator]().next().value?.segment ?? s[0] : Array.from(s)[0] ?? s) ?? s).toLocaleUpperCase();
}
/** Relative luminance (WCAG) of an oklch colour, clamped into sRGB. */
function oklchLuminance(l, c, hDeg) {
	const h = hDeg * Math.PI / 180;
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const l_ = (l + .3963377774 * a + .2158037573 * b) ** 3;
	const m_ = (l - .1055613458 * a - .0638541728 * b) ** 3;
	const s_ = (l - .0894841775 * a - 1.291485548 * b) ** 3;
	const clamp = (v) => Math.min(1, Math.max(0, v));
	const r = clamp(4.0767416621 * l_ - 3.3077115913 * m_ + .2309699292 * s_);
	const g = clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - .3413193965 * s_);
	const bl = clamp(-.0041960863 * l_ - .7034186147 * m_ + 1.707614701 * s_);
	return .2126 * r + .7152 * g + .0722 * bl;
}
/** WCAG contrast ratio of two relative luminances. */
const contrastRatio = (y1, y2) => (Math.max(y1, y2) + .05) / (Math.min(y1, y2) + .05);
const AVATAR_L = .7;
const AVATAR_C = .12;
const INK = [{
	css: "oklch(0.2 0 0)",
	y: oklchLuminance(.2, 0, 0)
}, {
	css: "oklch(1 0 0)",
	y: 1
}];
/**
* The fallback's colours for a seed: oklch(0.7 0.12 <hue>), the hue from a
* hash so a person keeps one colour, the letter in whichever ink contrasts
* more (at least 4.5:1 on every hue).
*/
function avatarColors(seed) {
	const hue = parseInt(hashId(`avatar:${seed}`), 36) % 360;
	const y = oklchLuminance(AVATAR_L, AVATAR_C, hue);
	const ink = INK.reduce((best, i) => contrastRatio(i.y, y) > contrastRatio(best.y, y) ? i : best);
	return {
		bg: `oklch(${AVATAR_L} ${AVATAR_C} ${hue})`,
		fg: ink.css,
		hue
	};
}
/**
* A line's avatar. The agent's is `agentAvatar` (the host app's logo, a URL
* or an element) named by its label. Anyone else's comes from `avatarFor`
* (the host's resolver), else the line's own `sender`; the viewer's own
* lines (owner lines on the owner's page, friend lines on a friend's) fill
* the gaps from `user` and are named "you".
*/
function lineAvatar(m, opts) {
	if (m.from === "agent") {
		const name = m.agentId || m.label || "agent";
		const a = opts.agentAvatar;
		const isSrc = typeof a === "string" || Array.isArray(a);
		return {
			srcs: isSrc ? avatarSrcs(a) : [],
			...a && !isSrc ? { node: a } : {},
			name,
			initialFrom: name,
			seed: `agent:${name}`,
			mine: false
		};
	}
	const mine = m.from === (opts.friend ? "friend" : "owner");
	const own = opts.avatarFor?.(m) ?? void 0;
	const s = {
		...mine ? opts.user : void 0,
		...m.sender,
		...own
	};
	const srcs = [
		...avatarSrcs(own?.avatar),
		...mine ? avatarSrcs(opts.user?.avatar) : [],
		...avatarSrcs(m.sender?.avatar)
	];
	const name = s.name || (m.from === "friend" ? "friend" : "owner");
	return {
		srcs: [...new Set(srcs)],
		name: mine ? "you" : name,
		initialFrom: name,
		seed: s.id || m.thread || m.from,
		mine
	};
}

//#endregion
export { lineAvatar as a, initialOf as i, avatarSrcs as n, pageHint as o, hashId as r, when as s, avatarColors as t };
//# sourceMappingURL=avatar-BHTNm21C.js.map