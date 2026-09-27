import { describe, expect, test } from "bun:test";
import { candidates, crosses, distance, dockColumn, GAP, leader, nearest, overlap, place, placeCallouts, score, WEIGHT, type Obstacle, type PlaceInput, type Rect } from "../client/place.ts";

const W = { s: WEIGHT.selected, r: WEIGHT.related, l: WEIGHT.label, m: WEIGHT.mark } as const;
const KIND = { s: "selected", r: "related", l: "label", m: "mark" } as const;
const obstacles = (packed: string): Obstacle[] =>
  packed.split(" ").map((o) => {
    const [x, y, w, h, k] = o.split(",") as [string, string, string, string, keyof typeof W];
    return { x: +x, y: +y, w: +w, h: +h, weight: W[k], kind: KIND[k] };
  });

// Layouts measured in the browser at 1280px (shot's default width), dark theme, full view.
// hub: templates/hub.md with sel=researcher. gantt: templates/gantt.md with sel=launch-security-review.
const FIXTURES = {
  hub: { anchor: {x: 14, y: 208, w: 138, h: 55}, subject: {x: 14, y: 208, w: 138, h: 55}, card: {w: 300, h: 291}, stage: {w: 1080, h: 416}, plot: {x: 0, y: 0, w: 1080, h: 416}, plotMin: 936,
    obstacles: "14,208,138,55,s 52,228,62,14,s 148,232,8,8,r 164,232,8,8,r 179,232,8,8,r 195,232,8,8,r 210,232,8,8,r 225,232,8,8,r 241,232,8,8,r 256,232,8,8,r 272,232,8,8,r 287,232,8,8,r 303,232,8,8,r 318,232,8,8,r 333,232,8,8,r 349,232,8,8,r 364,232,8,8,r 380,232,8,8,r 395,232,8,8,r 410,232,8,8,r 422,225,8,8,r 422,210,8,8,r 422,194,8,8,r 422,179,8,8,r 422,164,8,8,r 422,148,8,8,r 436,144,8,8,r 451,144,8,8,r 467,144,8,8,r 247,217,85,12,r 250,217,78,12,r 471,111,138,55,r 498,132,85,14,r 260,23,57,12,l 749,14,78,12,l 765,58,57,12,l 715,126,62,12,l 770,226,42,12,l 550,230,78,12,l 62,35,42,14,l 980,35,33,14,l 972,228,50,14,l 526,325,29,14,l 33,389,41,12,l 109,389,59,12,l 201,389,47,12,l 282,389,29,12,l 347,389,24,12,l 405,389,29,12,l 615,133,5,12,l 14,14,138,55,m 928,14,138,55,m 928,208,138,55,m 471,305,138,55,m" },
  gantt: { anchor: {x: 505, y: 282, w: 24, h: 16}, subject: {x: 32, y: 282, w: 863, h: 16}, card: {w: 300, h: 360}, stage: {w: 1080, h: 536}, plot: {x: 0, y: 0, w: 960, h: 536}, plotMin: 720,
    obstacles: "505,282,390,16,s 32,283,78,14,s 446,130,8,8,r 453,141,8,8,r 438,146,8,8,r 420,146,8,8,r 403,146,8,8,r 385,146,8,8,r 368,146,8,8,r 350,146,8,8,r 332,146,8,8,r 315,146,8,8,r 297,146,8,8,r 280,146,8,8,r 262,146,8,8,r 245,146,8,8,r 227,146,8,8,r 218,157,8,8,r 218,175,8,8,r 218,193,8,8,r 218,210,8,8,r 218,228,8,8,r 218,245,8,8,r 218,263,8,8,r 231,270,8,8,r 249,270,8,8,r 266,270,8,8,r 284,270,8,8,r 301,270,8,8,r 319,270,8,8,r 337,270,8,8,r 354,270,8,8,r 372,270,8,8,r 389,270,8,8,r 407,270,8,8,r 424,270,8,8,r 442,270,8,8,r 460,270,8,8,r 477,270,8,8,r 491,277,8,8,r 501,286,8,8,r 227,126,223,16,r 32,127,43,14,r 468,128,18,13,l 501,162,8,8,r 509,173,8,8,r 493,178,8,8,r 475,178,8,8,r 457,178,8,8,r 439,178,8,8,r 421,178,8,8,r 403,178,8,8,r 386,178,8,8,r 368,178,8,8,r 350,178,8,8,r 332,178,8,8,r 314,178,8,8,r 296,178,8,8,r 278,178,8,8,r 260,178,8,8,r 243,178,8,8,r 225,178,8,8,r 207,180,8,8,r 206,198,8,8,r 206,216,8,8,r 206,234,8,8,r 206,252,8,8,r 209,269,8,8,r 226,270,8,8,r 244,270,8,8,r 262,270,8,8,r 280,270,8,8,r 298,270,8,8,r 316,270,8,8,r 333,270,8,8,r 351,270,8,8,r 369,270,8,8,r 387,270,8,8,r 405,270,8,8,r 423,270,8,8,r 441,270,8,8,r 459,270,8,8,r 477,270,8,8,r 491,276,8,8,r 501,286,8,8,r 227,158,278,16,r 32,159,43,14,r 891,286,8,8,r 899,296,8,8,r 905,309,8,8,r 905,326,8,8,r 905,342,8,8,r 905,359,8,8,r 905,375,8,8,r 905,392,8,8,r 905,409,8,8,r 903,425,8,8,r 886,426,8,8,r 874,433,8,8,r 884,442,8,8,r 888,439,14,14,r 32,439,66,14,r 908,440,36,13,r 138,34,30,13,l 203,34,30,13,l 268,34,36,13,l 333,34,36,13,l 398,34,36,13,l 463,34,30,13,l 528,34,36,13,l 593,34,36,13,l 658,34,36,13,l 723,34,30,13,l 788,34,36,13,l 853,34,36,13,l 32,66,34,13,l 32,222,41,13,l 32,346,41,13,l 32,95,52,14,l 32,191,54,14,l 598,192,18,13,l 32,251,46,14,l 559,252,60,13,l 32,315,59,14,l 858,316,18,13,l 32,375,57,14,l 32,407,80,14,l 576,472,34,13,l 156,504,88,13,l 282,504,34,13,l 357,504,102,13,l 902,284,6,13,l 846,316,6,13,l 32,66,548,13,m 32,222,863,13,m 32,346,872,13,m 32,94,195,16,m 32,190,603,16,m 32,250,603,16,m 32,314,863,16,m 32,374,863,16,m 32,406,863,16,m 576,52,34,433,m" },
};
const input = (f: (typeof FIXTURES)[keyof typeof FIXTURES]): PlaceInput => ({ ...f, obstacles: obstacles(f.obstacles) });

/** Covered share of the related area and covered px² of the selection, for the rect the card ends up in. */
function covered(rect: Rect, obs: Obstacle[]) {
  return coveredBy(rect, obs);
}

/** The right dock pads the stage by the card, so the plot scales down to what is left of it. */
function afterDock(i: PlaceInput): Obstacle[] {
  const plot = i.plot ?? { x: 0, y: 0, w: i.stage.w, h: i.stage.h };
  const k = Math.min(1, (i.stage.w - i.card.w - 16) / plot.w);
  return i.obstacles.map((o) => ({ ...o, x: o.x * k, y: o.y * k, w: o.w * k, h: o.h * k }));
}

function coveredBy(rect: Rect, obs: Obstacle[]) {
  const sel = obs.filter((o) => o.kind === "selected").reduce((a, o) => a + overlap(rect, o), 0);
  const rel = obs.filter((o) => o.kind === "related");
  const area = rel.reduce((a, o) => a + o.w * o.h, 0);
  return { selected: sel, related: area ? rel.reduce((a, o) => a + overlap(rect, o), 0) / area : 0 };
}

describe("geometry", () => {
  test("overlap and distance", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(overlap(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(25);
    expect(overlap(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(0);
    expect(distance(a, { x: 13, y: 14, w: 1, h: 1 })).toBe(5);
    expect(distance(a, { x: 2, y: 2, w: 1, h: 1 })).toBe(0);
  });

  test("leader runs between the nearest points and turns into a caret when short", () => {
    const l = leader({ x: 100, y: 0, w: 50, h: 40 }, { x: 0, y: 10, w: 20, h: 10 });
    expect([l.x1, l.y1, l.x2, l.y2]).toEqual([100, 15, 20, 15]);
    expect(l.caret).toBe(false);
    expect(leader({ x: 32, y: 0, w: 50, h: 40 }, { x: 0, y: 10, w: 20, h: 10 }).caret).toBe(true);
  });

  test("a leader that would cross a label takes another edge", () => {
    const card = { x: 100, y: 100, w: 100, h: 60 }, anchor = { x: 120, y: 0, w: 40, h: 20 };
    const label = { x: 125, y: 50, w: 80, h: 14 };
    const plain = leader(card, anchor);
    expect(crosses(plain.x1, plain.y1, plain.x2, plain.y2, label)).toBe(true);
    const l = leader(card, anchor, [label]);
    expect(crosses(l.x1, l.y1, l.x2, l.y2, label)).toBe(false);
  });
});

describe("candidates and score", () => {
  const base: PlaceInput = { anchor: { x: 200, y: 100, w: 20, h: 20 }, card: { w: 100, h: 60 }, stage: { w: 600, h: 300 }, obstacles: [] };

  test("four sides by three alignments sit a gap away from the anchor", () => {
    const c = candidates(base);
    const right = c.filter((x) => x.side === "right");
    expect(right).toHaveLength(3);
    expect(right.every((r) => r.x === 220 + GAP)).toBe(true);
    expect(c.filter((x) => x.side === "above").every((r) => r.y === 100 - GAP - 60)).toBe(true);
    expect(c.some((x) => x.side === "free")).toBe(true);
  });

  test("the gutter right of a narrow plot is a candidate", () => {
    const c = candidates({ ...base, plot: { x: 0, y: 0, w: 400, h: 300 } });
    expect(c.find((x) => x.side === "gutter")).toMatchObject({ x: 400 + GAP });
  });

  test("leaving the stage sideways costs 1000; covering a whole label costs its weight", () => {
    expect(score({ x: -10, y: 100, w: 100, h: 60 }, base)).toBeGreaterThan(1000);
    const label: Obstacle = { x: 300, y: 100, w: 40, h: 10, weight: WEIGHT.label, kind: "label" };
    const at = { x: 290, y: 90, w: 100, h: 60 };
    expect(score(at, { ...base, obstacles: [label] }) - score(at, base)).toBeCloseTo(WEIGHT.label, 5);
  });

  test("is deterministic", () => {
    const i = input(FIXTURES.hub);
    expect(place(i)).toEqual(place(i));
  });
});

describe("place", () => {
  test("floats next to the anchor when nothing is in the way", () => {
    const p = place({ anchor: { x: 100, y: 100, w: 20, h: 20 }, card: { w: 200, h: 100 }, stage: { w: 800, h: 400 }, obstacles: [] });
    expect(p.mode).toBe("float");
    expect(distance(p.rect, { x: 100, y: 100, w: 20, h: 20 })).toBeLessThanOrEqual(GAP);
  });

  test("avoids the selection and labels, moving away from the anchor if it has to", () => {
    const sel: Obstacle = { x: 100, y: 100, w: 20, h: 20, weight: WEIGHT.selected, kind: "selected" };
    const labels: Obstacle[] = [{ x: 132, y: 60, w: 300, h: 100, weight: WEIGHT.label, kind: "label" }];
    const p = place({ anchor: sel, card: { w: 200, h: 100 }, stage: { w: 800, h: 400 }, obstacles: [sel, ...labels] });
    expect(p.mode).toBe("float");
    expect(overlap(p.rect, sel)).toBe(0);
    expect(overlap(p.rect, labels[0])).toBe(0);
  });

  test("docks when every spot would cover the selection", () => {
    const sel: Obstacle = { x: 0, y: 0, w: 1100, h: 200, weight: WEIGHT.selected, kind: "selected" };
    expect(place({ anchor: sel, card: { w: 300, h: 250 }, stage: { w: 1100, h: 200 }, obstacles: [sel] }).mode).toBe("dock-right");
    expect(place({ anchor: sel, card: { w: 300, h: 250 }, stage: { w: 600, h: 200 }, obstacles: [sel] }).mode).toBe("dock-below");
  });

  test("the right dock never squeezes the plot below its minimum width", () => {
    const sel: Obstacle = { x: 0, y: 0, w: 1000, h: 200, weight: WEIGHT.selected, kind: "selected" };
    const i = { anchor: sel, card: { w: 300, h: 250 }, stage: { w: 1200, h: 200 }, plot: { x: 0, y: 0, w: 1000, h: 200 }, obstacles: [sel] };
    expect(place(i).mode).toBe("dock-right");
    expect(place({ ...i, plotMin: 900 }).mode).toBe("dock-below");
  });

  test("a plot narrower than the stage keeps its gutter: the card docks 16px right of it, level with the anchor, on the grid", () => {
    const anchor = { x: 200, y: 150, w: 40, h: 20 };
    const p = place({ anchor, card: { w: 256, h: 180 }, stage: { w: 1232, h: 400 }, plot: { x: 0, y: 0, w: 960, h: 400 }, obstacles: [] });
    expect(p.mode).toBe("dock-right");
    expect(p.rect).toEqual({ x: 976, y: 72, w: 256, h: 180 });
    expect(p.rect.y % 8).toBe(0);
  });

  test("a floating card stays within reach of its anchor and covers no label", () => {
    const anchor: Obstacle = { x: 40, y: 40, w: 20, h: 20, weight: WEIGHT.selected, kind: "selected" };
    const labels: Obstacle[] = [{ x: 0, y: 72, w: 800, h: 400, weight: WEIGHT.label, kind: "label" }, { x: 72, y: 0, w: 800, h: 72, weight: WEIGHT.label, kind: "label" }];
    const p = place({ anchor, card: { w: 200, h: 100 }, stage: { w: 800, h: 400 }, obstacles: [anchor, ...labels] });
    expect(p.mode).not.toBe("float");
  });

  test("small screens always dock under the figure", () => {
    expect(place({ anchor: { x: 0, y: 0, w: 10, h: 10 }, card: { w: 240, h: 100 }, stage: { w: 400, h: 300 }, obstacles: [], mobile: true }).mode).toBe("dock-below");
  });

  for (const name of ["hub", "gantt"] as const) {
    test(`${name}: the card covers none of the selection and at most 25% of what it lights up`, () => {
      const i = input(FIXTURES[name]);
      const p = place(i);
      const c = covered(p.rect, p.mode === "dock-right" ? afterDock(i) : i.obstacles);
      if (p.mode !== "dock-below") {
        expect(c.selected).toBe(0);
        expect(c.related).toBeLessThanOrEqual(0.25);
      }
      expect(p.covers.selected).toBe(0);
      expect(["float", "dock-right", "dock-below"]).toContain(p.mode);
    });
  }

  test("hub: Researcher's card leaves the 'writes findings' edge and Shared memory uncovered", () => {
    const i = input(FIXTURES.hub);
    const p = place(i);
    if (p.mode === "dock-below") return expect(p.rect.y).toBeGreaterThan(i.stage.h);
    const obs = p.mode === "dock-right" ? afterDock(i) : i.obstacles;
    for (const o of obs.filter((x) => x.kind !== "mark")) expect(overlap(p.rect, o)).toBe(0);
  });
});

describe("placeCallouts (annotation layer)", () => {
  const stage = { w: 600, h: 300 };
  const bar = (y: number, w: number): Obstacle => ({ x: 100, y, w, h: 20, weight: WEIGHT.mark, kind: "mark" });
  const bars = [bar(20, 480), bar(60, 200), bar(100, 160), bar(140, 120)];
  const labels: Obstacle[] = bars.map((b) => ({ x: b.x + b.w + 4, y: b.y + 4, w: 36, h: 12, weight: WEIGHT.label, kind: "label" }));

  test("callouts stay inside the stage, off their targets, off every label and off each other", () => {
    const items = [
      { anchor: { x: 92, y: 12, w: 16, h: 16 }, w: 180, h: 48, keep: [bars[0]] },
      { anchor: { x: 92, y: 132, w: 16, h: 16 }, w: 180, h: 48, keep: [bars[3]] },
    ];
    const spots = placeCallouts(items, stage, [...bars, ...labels]);
    expect(spots.every(Boolean)).toBe(true);
    const [a, b] = spots as Rect[];
    for (const r of [a, b]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(stage.w);
      expect(r.y + r.h).toBeLessThanOrEqual(stage.h);
      for (const l of labels) expect(overlap(r, l)).toBe(0);
    }
    expect(overlap(a, bars[0])).toBe(0);
    expect(overlap(b, bars[3])).toBe(0);
    expect(overlap(a, b)).toBe(0);
  });

  test("a callout sits near what its note is about, and its leader goes to the closest part", () => {
    const item = { anchor: { x: 92, y: 12, w: 16, h: 16 }, w: 180, h: 40, keep: [bars[0]] };
    const [r] = placeCallouts([item], stage, bars) as Rect[];
    expect(Math.min(distance(r, item.anchor), distance(r, bars[0]))).toBeLessThanOrEqual(40);
    expect([item.anchor, bars[0]]).toContainEqual(nearest(r, item));
  });

  test("no clean spot means no callout (the note stays in the reading panel)", () => {
    const wall: Obstacle[] = [];
    for (let y = 0; y < 300; y += 14) for (let x = 0; x < 600; x += 44) wall.push({ x, y, w: 40, h: 12, weight: WEIGHT.label, kind: "label" });
    expect(placeCallouts([{ anchor: { x: 10, y: 10, w: 16, h: 16 }, w: 180, h: 40 }], stage, wall)).toEqual([null]);
    expect(placeCallouts([{ anchor: { x: 10, y: 10, w: 16, h: 16 }, w: 700, h: 40 }], stage, [])).toEqual([null]);
  });

  test("a callout keeps 8px clear of every obstacle, sits on the grid, and prefers the lane right of the plot", () => {
    const plot = { x: 0, y: 0, w: 340, h: 300 };
    const obs: Obstacle[] = [{ x: 0, y: 0, w: 340, h: 300, weight: WEIGHT.mark, kind: "mark" }];
    const [r] = placeCallouts([{ anchor: { x: 330, y: 100, w: 20, h: 20 }, w: 200, h: 48 }], stage, obs, plot) as Rect[];
    expect(r.x).toBe(360);
    expect(r.x % 8 + r.y % 8).toBe(0);
    for (const o of obs) expect(overlap(r, { x: o.x - 8, y: o.y - 8, w: o.w + 16, h: o.h + 16 })).toBe(0);
  });

  test("is deterministic", () => {
    const items = [{ anchor: { x: 300, y: 150, w: 16, h: 16 }, w: 160, h: 40 }];
    expect(placeCallouts(items, stage, bars)).toEqual(placeCallouts(items, stage, bars));
  });

  describe("with the card docked in the gutter", () => {
    // wardley at 1280px: a 960px plot, a 1232px stage, the 256px card docks 16px right of the plot
    const wide = { w: 1232, h: 400 };
    const plot = { x: 0, y: 0, w: 960, h: 400 };
    const dock = dockColumn(wide, plot, 256)!;
    const filled: Obstacle[] = [{ x: 0, y: 0, w: 960, h: 400, weight: WEIGHT.mark, kind: "mark" }];
    const items = [
      { anchor: { x: 900, y: 360, w: 20, h: 20 }, w: 240, h: 88 },
      { anchor: { x: 100, y: 360, w: 20, h: 20 }, w: 240, h: 88 },
      { anchor: { x: 500, y: 40, w: 20, h: 20 }, w: 240, h: 88 },
    ];

    test("the card's column is where place() docks it, and none when the gutter is too narrow", () => {
      expect(dock).toEqual({ x: 976, y: 0, w: 256, h: 400 });
      expect(place({ anchor: items[0].anchor, card: { w: 256, h: 180 }, stage: wide, plot, obstacles: [] }).rect.x).toBe(dock.x);
      expect(dockColumn({ w: 1200, h: 400 }, plot, 256)).toBeUndefined();
      expect(dockColumn(wide, undefined, 256)).toBeUndefined();
    });

    test("no callout lands in the card's column; they take the lane under the plot, side by side", () => {
      const spots = placeCallouts(items, wide, filled, plot, dock);
      expect(spots.every(Boolean)).toBe(true);
      const rs = spots as Rect[];
      for (const r of rs) {
        expect(overlap(r, { ...dock, h: 10_000 })).toBe(0);
        expect(r.y).toBeGreaterThanOrEqual(plot.y + plot.h + 16);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x % 8 + r.y % 8).toBe(0);
      }
      expect(new Set(rs.map((r) => r.y)).size).toBe(1);
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(overlap(rs[i], rs[j])).toBe(0);
    });

    test("without the card's column the same callouts use the right lane, as before", () => {
      const spots = placeCallouts(items, wide, filled, plot) as Rect[];
      expect(spots.every((r) => r && r.x === 976)).toBe(true);
    });

    test("a gutter wide enough for the card and a callout keeps its right lane, past the card", () => {
      const wider = { w: 1520, h: 400 };
      // near the top of the plot the lane beside it is closer than the one under it
      const [r] = placeCallouts([{ anchor: { x: 900, y: 40, w: 20, h: 20 }, w: 240, h: 88 }], wider, filled, plot, dockColumn(wider, plot, 256)) as Rect[];
      expect(r.x).toBe(976 + 256 + 16);
      expect(r.y + r.h).toBeLessThanOrEqual(wider.h);
    });

    test("callouts that fit in the plot stay there; the lane is only for those that don't", () => {
      const open: Obstacle[] = [{ x: 0, y: 0, w: 960, h: 200, weight: WEIGHT.mark, kind: "mark" }];
      const [r] = placeCallouts([{ anchor: { x: 100, y: 180, w: 20, h: 20 }, w: 240, h: 88 }], wide, open, plot, dock) as Rect[];
      expect(r.y + r.h).toBeLessThanOrEqual(plot.h);
    });
  });
});
