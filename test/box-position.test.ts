import { describe, expect, it } from "bun:test";
import { ChatBox } from "../src/box.ts";

/** A box with no DOM: only what resetPosition and clampTop touch. */
const bare = (attrs: Record<string, string> = {}) => {
  const written: Record<string, string> = {};
  const events: { type: string; detail: unknown }[] = [];
  const box = Object.assign(Object.create(ChatBox.prototype), {
    pos: { x: -120, y: -300 },
    style: { transform: "translate(-120px, -300px)" },
    els: { bar: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 40 }) } },
    write: (k: string, v: string) => void (written[k] = v),
    placeFloat: () => {},
    fit: () => {},
    getAttribute: (k: string) => attrs[k] ?? null,
    dispatchEvent: (e: CustomEvent) => void events.push({ type: e.type, detail: e.detail }),
  }) as unknown as {
    resetPosition(): void;
    clampTop: number;
    pos: { x: number; y: number };
    style: { transform: string };
  };
  return { box, written, events };
};

describe("ChatBox position", () => {
  it("resetPosition goes home, forgets the drag and says where the bar is", () => {
    const { box, written, events } = bare();
    box.resetPosition();
    expect(box.pos).toEqual({ x: 0, y: 0 });
    expect(box.style.transform).toBe("translate(0px, 0px)");
    expect(JSON.parse(written.pos!)).toEqual({ x: 0, y: 0 });
    expect(events).toEqual([
      {
        type: "liagent-move",
        detail: { x: 0, y: 0, rect: { left: 10, top: 20, width: 300, height: 40 } },
      },
    ]);
  });

  it("clampTop reads clamp-top; junk or negative is 0", () => {
    expect(bare({ "clamp-top": "56" }).box.clampTop).toBe(56);
    expect(bare({ "clamp-top": "-4" }).box.clampTop).toBe(0);
    expect(bare({ "clamp-top": "x" }).box.clampTop).toBe(0);
    expect(bare().box.clampTop).toBe(0);
  });
});
