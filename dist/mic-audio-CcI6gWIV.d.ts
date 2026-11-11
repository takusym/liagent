//#region src/aec.d.ts
/**
 * The mic's echo cancellation switch (localStorage `liagent:voice-aec`, per
 * device) and what it selects. Small and free of the mic code, so a host's
 * settings page (or the box's menu) can show the switch without loading the
 * mic.
 *
 * - On (the default): echoCancellation, noiseSuppression and autoGainControl.
 *   The mic stays open while anything plays; the user can talk over the
 *   agent (barge-in, src/voice.ts). Some mobile browsers then route playback
 *   as a voice call (a thinner speaker).
 * - Off ("0"): no processing at all. Playback stays on the media stream, and
 *   the mic holds its capture while the agent speaks (src/voice.ts `hold`)
 *   and while the page plays its own audio (src/page-audio.ts), so neither
 *   is transcribed.
 *
 * applyAec writes the switch, tells the page (AEC_EVENT) and reopens an open
 * mic at once, so the difference is heard right away; with the mic off it
 * applies when it next opens.
 */
declare const VOICE_AEC_KEY = "liagent:voice-aec";
/** Window event after a change (detail: { on }), for switches shown elsewhere. */
declare const AEC_EVENT = "liagent-voice-aec";
/** The mic with echo cancellation on (the default). */
declare const AEC_CONSTRAINTS: {
  readonly echoCancellation: true;
  readonly noiseSuppression: true;
  readonly autoGainControl: true;
  readonly channelCount: 1;
};
/** Echo cancellation off: no processing at all; capture is held while the page plays. */
declare const RAW_CONSTRAINTS: {
  readonly echoCancellation: false;
  readonly noiseSuppression: false;
  readonly autoGainControl: false;
  readonly channelCount: 1;
};
/** The former name of RAW_CONSTRAINTS. */
declare const LEGACY_CONSTRAINTS: {
  readonly echoCancellation: false;
  readonly noiseSuppression: false;
  readonly autoGainControl: false;
  readonly channelCount: 1;
};
/** getUserMedia's audio constraints for a mode. */
declare const micConstraints: (aec?: boolean) => MediaTrackConstraints;
/** Echo cancellation on (default on; "0" = off). */
declare function aecOn(): boolean;
/** Write the switch (never throws). The mic is not touched: see applyAec. */
declare function setAec(on: boolean): void;
/**
 * The switch, from a tap: write it, tell the page, and reopen the mic if it
 * is on. "reopened": the new mode is live now; "next-open": the mic is off
 * (or an older session cannot reopen), so it applies when it next opens.
 */
declare function applyAec(on: boolean, g?: Record<string, unknown>): Promise<"reopened" | "next-open">;
//#endregion
//#region src/page-audio.d.ts
/**
 * Audio the page plays outside the agent's read-aloud (a host's own sound
 * clips, its own speechSynthesis): with echo cancellation off (src/aec.ts)
 * the mic holds its capture while any of it plays, and PAGE_AUDIO_TAIL_MS
 * after the last one ends (the room's echo), so it is never transcribed.
 *
 *   const end = pageAudio().start();   // a sound starts
 *   audio.onended = end;               // …and ends (again is a no-op)
 *
 * One registry per page, on globalThis, so every copy of the module shares
 * it. Pure apart from its timers, which can be injected (tests).
 */
/** Capture resumes this long after the last sound ends. */
declare const PAGE_AUDIO_TAIL_MS = 400;
type PageAudio = {
  /** A sound starts; call the returned function once when it ends. */start(): () => void; /** Something plays now, or ended less than the tail ago. */
  playing(): boolean;
  subscribe(f: (playing: boolean) => void): () => void;
};
declare function createPageAudio(d?: {
  setTimer?: (f: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  tailMs?: number;
  maxMs?: number;
}): PageAudio;
/** The page's registry, shared by every copy of this module. */
declare function pageAudio(): PageAudio;
//#endregion
//#region src/mic.d.ts
/**
 * The mic, without the browser: a listening mode in which a voice-activity
 * detector cuts speech into utterances, each one sent to the host's STT
 * endpoint as soon as it ends. Requests run in parallel; transcripts are
 * appended in the order spoken. A long utterance also sends rolling partial
 * chunks, whose text shows dimmed until the final one replaces it. Nothing is
 * sent as a chat message here: the text lands in the draft, and the rules
 * below (appendDictation) say when it goes out. The VAD, the upload and the
 * timers are injected, so all of this is tested with fakes (test/mic.test.ts);
 * src/mic-audio.ts has the browser pieces and src/mic-button.ts the element.
 */
/** Longest utterance: past this it is cut and sent, and listening goes on. */
declare const MAX_UTTERANCE_MS = 30000;
/** No audio frame for this long while listening counts as a stalled mic (createMic stallMs). */
declare const STALL_MS = 5000;
/** The VADs hand over 16 kHz mono. */
declare const RATE = 16000;
/** Partials: one every PARTIAL_EVERY_MS of speech, once it is PARTIAL_MIN_MS long… */
declare const PARTIAL_EVERY_MS = 2500;
declare const PARTIAL_MIN_MS = 3000;
/** …each chunk overlapping the one before by this much, so a word cut at its edge is heard whole. */
declare const PARTIAL_OVERLAP_MS = 1500;
/** Shown in the input for an utterance still being transcribed. */
declare const PENDING_MARK = "\u2026";
type MicState = "off" | "loading" | "listening" | "capturing";
/** What the button shows, from the state and the transcripts still out. */
type MicStatus = "idle" | "loading" | "listening" | "capturing" | "transcribing" | "speaking";
/**
 * `speaking`: the agent's reply is being read while the mic is on. Capturing
 * wins: with echo cancellation the user can talk over the agent.
 */
declare function micStatus(state: MicState, pending: number, speaking?: boolean): MicStatus;
/** What a VAD must do. `flush` ends the current utterance now (the 30 s cap). */
type Vad = {
  start(): Promise<void> | void;
  pause(): Promise<void> | void;
  flush(): Promise<void> | void;
  destroy(): Promise<void> | void;
};
type VadEvents = {
  onSpeechStart(): void; /** One utterance, 16 kHz mono samples in [-1, 1]. */
  onSpeechEnd(samples: Float32Array): void; /** Speech seemed to start but was too short to keep. */
  onMisfire(): void;
  /**
   * Every frame heard (16 kHz), for the partials; only those while capturing
   * are kept. `prob`: the VAD's speech probability for it (Silero only).
   */
  onFrame?(frame: Float32Array, prob?: number): void;
};
type VadFactory = (ev: VadEvents) => Promise<Vad>;
/** A non-2xx answer from the STT endpoint. */
declare class SttError extends Error {
  readonly status: number;
  constructor(status: number, message: string);
}
/** getUserMedia refused or found nothing: the fallback needs the mic too, so it is not tried. */
declare function isMicDenied(e: unknown): boolean;
/** The notes' wording; a host can translate it (`<liagent-mic>.strings`). */
type MicErrorStrings = {
  denied: string;
  noMic: string;
  signIn: string;
  tooMuch: string; /** `{status}` is replaced by the HTTP status. */
  failed: string; /** `{message}` is replaced by the error's message. */
  other: string; /** No audio from the mic for a while (MicStalledError); cleared when audio comes back. */
  stalled: string;
};
declare const MIC_ERROR_STRINGS_EN: MicErrorStrings;
/** The short note by the button for an error. */
declare function micErrorNote(e: unknown, t?: Partial<MicErrorStrings>): string;
/**
 * Utterances in flight, in the order they were spoken. `take()` hands back
 * the text of every finished one that has nothing unfinished before it.
 */
declare class UtteranceQueue {
  private next;
  private head;
  private done;
  private partials;
  private sources;
  add(): number;
  resolve(seq: number, text: string | null, source?: TextSource): void;
  /** Resolved already (a stream's final came, or the upload answered)? */
  has(seq: number): boolean;
  /** Interim text for one not yet resolved (ignored once it is). */
  partial(seq: number, text: string): void;
  getPartial(seq: number): string;
  /** Text now in order (failed ones are skipped), joined with joinText. */
  take(): string;
  /** take(), kept apart by source: each run of the same source joined (a stream's text vs an upload's). */
  takeRuns(): {
    text: string;
    source: TextSource;
  }[];
  /** Utterances still being transcribed. */
  pending(): number;
  /**
   * What the input shows, dimmed, after the draft: for each utterance not yet
   * taken, its text (done, waiting on an earlier one), its partial, or
   * PENDING_MARK (one mark for a run of them).
   */
  interim(): string;
}
/** Append `b` to `a`: a space between them, except between CJK characters or at a line start. */
declare function joinText(a: string, b: string): string;
/** A draft ending a sentence (any script's full stop, ! or ?). */
declare const ENDS_SENTENCE: RegExp;
/**
 * Spoken (or IME-dictated) sentences go out at once from this many characters
 * (trimmed): typing arrives a character at a time, so 3 at once is dictation.
 */
declare const AUTO_SEND_MIN = 3;
/**
 * Typed text that arrived at once (an outside dictation IME): AUTO_SEND_MIN
 * or more characters since the draft last settled, and the draft now ends a
 * sentence. Then it is sent at once.
 */
declare function isDictationBurst(settledLen: number, draft: string): boolean;
/**
 * Spoken text always ends a sentence ("auto-punctuate, then commit"): Whisper
 * usually adds the stop itself; when it doesn't, add one that fits the text —
 * 。/？ for CJK, ./? otherwise, a question by its particle or opening word.
 * Text that already ends in any punctuation (…, ～, quotes) is left alone.
 */
declare function punctuate(text: string): string;
/**
 * A final transcript lands in the draft, punctuated, and is committed at once
 * (shown, then sent) whenever it carries any words — a short "好" or "OK"
 * too. Partials never come here; typing never does (see isDictationBurst).
 */
declare function appendDictation(draft: string, text: string): {
  draft: string;
  send: boolean;
};
/**
 * Two overlapping chunks' transcripts as one: the longest run of words that
 * ends `a` and starts `b` is kept once ("the quick brown" + "brown fox" →
 * "the quick brown fox"). With no overlap they are just joined.
 */
declare function mergeOverlap(a: string, b: string): string;
/** Linear resampling to `to` Hz (the fallback VAD records at the device's rate). */
declare function resample(input: Float32Array, from: number, to: number): Float32Array;
/** 16-bit PCM WAV, mono: what every STT model takes, and every browser can make. */
declare function encodeWav(samples: Float32Array, rate?: number): Uint8Array;
/** The RMS level of a frame, for the energy fallback. */
declare function rms(frame: Float32Array): number;
/**
 * The energy-threshold VAD the mic falls back to when Silero is not given or
 * cannot load: feed it frames; it says when speech starts (two frames over
 * `on`) and ends (`hangMs` under `off`), keeping a frame of audio from before
 * the start.
 */
declare function energyGate(opts: {
  rate: number;
  on?: number;
  off?: number;
  hangMs?: number;
  minMs?: number;
}): {
  /** null: nothing happened; "start"; or the finished utterance (or "misfire"). */push(frame: Float32Array): null | "start" | "misfire" | Float32Array; /** End the utterance now (the cap, or listening turned off). */
  flush(): null | "misfire" | Float32Array;
};
type UploadInfo = {
  seq: number;
  durationMs: number;
  partial: boolean;
};
/** Where a final transcript came from: the batch upload of the utterance, or a streaming STT. */
type TextSource = "stt" | "stream";
/** No final from a stream this long after the utterance ended: it is uploaded the batch way instead. */
declare const STREAM_FINAL_MS = 8000;
/**
 * A streaming STT (createMic `stream`, `<liagent-mic>.streamStt`): one session per utterance, opened when speech
 * starts and fed every captured 16 kHz frame from the VAD. Its partials show dimmed like the batch partials; its
 * final covers the utterance, which is then never uploaded. No final within STREAM_FINAL_MS of the end (or open
 * or send throwing) and the utterance goes the batch way, so nothing is lost.
 */
type StreamStt = {
  open(cb: {
    /** Interim text of this utterance so far (replaces the previous one). */onPartial(text: string): void; /** The utterance's final text ("" for nothing said). Later calls are ignored. */
    onFinal(text: string): void;
  }): StreamSession;
};
type StreamSession = {
  /** One frame, 16 kHz mono samples in [-1, 1] (pcm16(frame) gives 16-bit PCM). */send(frame: Float32Array): void; /** The utterance ended: the final is due. */
  end(): void; /** Dropped (a misfire, the agent started speaking, the mic went off): no final is wanted. */
  abort?(): void;
};
/** A frame as 16-bit little-endian PCM, for a streaming STT that wants it. */
declare function pcm16(frame: Float32Array): Int16Array;
/**
 * Listening mode. `toggle()` turns it on (loading the VAD, or the fallback if
 * that fails, unless the mic itself was refused) and off. Each utterance is
 * encoded and uploaded at once; its transcript (in order) goes to `onText`,
 * and `onPending` counts those still out, with the interim text to show
 * dimmed. A capture longer than MAX_UTTERANCE_MS is cut and sent. A 401 turns
 * listening off; a 429 on a partial stops partials until the next turn-on.
 */
declare function createMic(d: {
  load: VadFactory;
  fallback?: VadFactory;
  upload: (wav: Uint8Array, info: UploadInfo) => Promise<string>;
  onState: (s: MicState) => void;
  onText: (text: string, source?: TextSource) => void;
  onPending: (n: number, interim: string) => void;
  onError?: (e: unknown) => void; /** A streaming STT (read at each utterance's start); its final covers the utterance (StreamStt). */
  stream?: () => StreamStt | undefined; /** Each frame's speech probability while capturing (a voice output's barge-in judge). */
  onProb?: (prob: number) => void; /** Rolling partial chunks for long utterances (on unless false). */
  partials?: boolean; /** Frames flow again after a MicStalledError (the host clears that error). */
  onRecover?: () => void; /** Every audio frame the VAD hands over while on (not held), with its time: a heartbeat. */
  onFrameBeat?: (at: number) => void;
  /**
   * No frame for this long while listening (not held): onError gets a
   * MicStalledError once (e.g. a suspended AudioContext on a live stream).
   * Default STALL_MS; 0 turns it off.
   */
  stallMs?: number;
  setTimer?: (f: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}): {
  toggle: () => Promise<void>;
  hold: (on: boolean) => void;
  held: () => boolean;
  off: () => Promise<void>;
  state: () => MicState;
};
/** What the STT endpoint answers: JSON with the transcript, and anything else it likes. */
type SttResult = {
  text: string;
  model?: string;
  ms?: number;
  language?: string;
};
/** Where and how to POST an utterance (docs/embed.md, "Voice input"). */
type SttRequest = {
  /** The endpoint, absolute or relative to the page, e.g. "/api/stt". */url: string; /** A language hint, sent as `?lang=` (none: the endpoint detects it). */
  lang?: string; /** Extra request headers (an API key, a CSRF token…). */
  headers?: Record<string, string>; /** fetch's credentials mode (default "same-origin"; "include" for a cookie on another origin). */
  credentials?: RequestCredentials; /** The audio's type (default "audio/wav"). */
  type?: string;
};
/** The URL with `lang` added to its query, when a hint is given. */
declare function sttUrl(url: string, lang?: string): string;
/**
 * POST one recording to the host's STT endpoint: the raw audio as the body
 * (16 kHz mono 16-bit PCM WAV) and its type as `content-type`. Answers the
 * endpoint's JSON (`text` defaults to ""). Throws SttError on non-2xx, with
 * the JSON's `error` as its message when there is one.
 */
declare function postStt(wav: Uint8Array, req: SttRequest | string, f?: typeof fetch): Promise<SttResult>;
/** The send tick: two soft sine tones, this loud at their peak, this long in all. */
declare const TICK_GAIN = 0.08;
declare const TICK_MS = 80;
/** The slice of an AudioContext the tick uses (a fake in the tests). */
type TickContext = {
  currentTime: number;
  destination: unknown;
  createOscillator(): {
    type: string;
    frequency: {
      setValueAtTime(v: number, t: number): unknown;
    };
    connect(n: unknown): unknown;
    start(t: number): void;
    stop(t: number): void;
  };
  createGain(): {
    gain: {
      setValueAtTime(v: number, t: number): unknown;
      linearRampToValueAtTime(v: number, t: number): unknown;
      exponentialRampToValueAtTime(v: number, t: number): unknown;
    };
    connect(n: unknown): unknown;
  };
};
/**
 * A short, soft "tick" when a spoken sentence goes out (opt-in on the
 * element: the `tick` attribute): two sine tones (the second a fifth up,
 * 30 ms later) through one gain with a 5 ms attack and an exponential decay,
 * TICK_MS long, peaking at TICK_GAIN. Web Audio only — no <audio> element —
 * so iOS keeps it silent when the ringer is muted.
 */
declare function scheduleTick(ctx: TickContext, at?: number): number;
//#endregion
//#region src/mic-audio.d.ts
declare function noteTrack(stream: {
  getAudioTracks(): {
    getSettings?(): object;
  }[];
}): void;
declare const appliedSettings: () => Record<string, unknown> | null;
declare function audioCtx(): AudioContext | null;
/** The AudioContext if one was made (never makes one). */
declare const existingCtx: () => AudioContext | null;
/** The browser can capture: getUserMedia and Web Audio. */
declare const canCapture: () => boolean;
/** The mic stream, with the constraints for `aec`; what was applied is noted. */
declare function micStream(aec?: boolean): Promise<MediaStream>;
/** The slice of vad-web's MicVAD the mic uses. */
type MicVADLike = {
  start(): Promise<void> | void;
  pause(): Promise<void> | void;
  destroy(): Promise<void> | void;
};
/** vad-web's module (or its UMD global, `window.vad`). */
type VadWebModule = {
  MicVAD: {
    new: (o: Record<string, unknown>) => Promise<MicVADLike>;
  };
};
/** Hands over vad-web: `() => import("@ricky0123/vad-web")`, or anything resolving to its module. */
type VadLoader = () => Promise<VadWebModule | {
  default: VadWebModule;
}>;
/** Silero VAD's source: a loader and where its model and onnxruntime's wasm are served from. */
type VadConfig = {
  load: VadLoader; /** vad-web's `baseAssetPath`: the directory with silero_vad_*.onnx and the worklet. */
  baseAssetPath?: string; /** vad-web's `onnxWASMBasePath`: the directory with onnxruntime-web's .wasm files. */
  onnxWASMBasePath?: string; /** Silero's model (default "v5"). */
  model?: "v5" | "legacy"; /** More MicVAD options (thresholds, redemption frames…), passed through. */
  options?: Record<string, unknown>;
};
type VadSource = VadLoader | VadConfig;
/**
 * vad-web from its UMD builds, by <script> tags: `vadBase` is vad-web's dist
 * directory (bundle.min.js, the model, the worklet) and `ortBase`
 * onnxruntime-web's (ort.wasm.min.js and the wasm). E.g. pinned on a CDN:
 *
 *   vadFromScripts("https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/",
 *                  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/")
 *
 * The page's CSP must allow both origins (script-src, connect-src, and
 * 'wasm-unsafe-eval').
 */
declare function vadFromScripts(vadBase: string, ortBase: string): VadConfig;
/**
 * Silero on the session's stream (never stops it): ends an utterance after
 * ~0.8 s of silence; each frame's speech probability goes to onFrame.
 */
declare function sileroVad(ev: VadEvents, stream: MediaStream, src: VadSource): Promise<Vad>;
/** The fallback: an energy threshold on the raw signal (energyGate), on the session's stream. */
declare function energyVad(ev: VadEvents, stream: MediaStream): Promise<Vad>;
//#endregion
export { pcm16 as $, StreamStt as A, Vad as B, PARTIAL_MIN_MS as C, STALL_MS as D, RATE as E, TICK_MS as F, encodeWav as G, VadFactory as H, TextSource as I, isMicDenied as J, energyGate as K, TickContext as L, SttRequest as M, SttResult as N, STREAM_FINAL_MS as O, TICK_GAIN as P, micStatus as Q, UploadInfo as R, PARTIAL_EVERY_MS as S, PENDING_MARK as T, appendDictation as U, VadEvents as V, createMic as W, mergeOverlap as X, joinText as Y, micErrorNote as Z, MAX_UTTERANCE_MS as _, micConstraints as _t, VadWebModule as a, sttUrl as at, MicState as b, canCapture as c, createPageAudio as ct, micStream as d, AEC_EVENT as dt, postStt as et, noteTrack as f, LEGACY_CONSTRAINTS as ft, ENDS_SENTENCE as g, applyAec as gt, AUTO_SEND_MIN as h, aecOn as ht, VadSource as i, scheduleTick as it, SttError as j, StreamSession as k, energyVad as l, pageAudio as lt, vadFromScripts as m, VOICE_AEC_KEY as mt, VadConfig as n, resample as nt, appliedSettings as o, PAGE_AUDIO_TAIL_MS as ot, sileroVad as p, RAW_CONSTRAINTS as pt, isDictationBurst as q, VadLoader as r, rms as rt, audioCtx as s, PageAudio as st, MicVADLike as t, punctuate as tt, existingCtx as u, AEC_CONSTRAINTS as ut, MIC_ERROR_STRINGS_EN as v, setAec as vt, PARTIAL_OVERLAP_MS as w, MicStatus as x, MicErrorStrings as y, UtteranceQueue as z };
//# sourceMappingURL=mic-audio-CcI6gWIV.d.ts.map