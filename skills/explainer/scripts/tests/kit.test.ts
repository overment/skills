import { describe, expect, test } from "bun:test";
import {
  delta, factList, fmtUnit, groupInfo, itemInfo, markValue, notes, onHover, onRel, onSel, ordinal, parseBands, parseCaveat,
  parseMarks, parseNotes, parseStory, parseUnit, pct, rank, ratio, readingSpec, refBand, refLine, scaleSpec, share, signed,
  stageWrap, trend,
} from "../engine/kit";
import { SpecError } from "../engine/types";

const frame = { x: 40, y: 10, w: 200, h: 100 };

function specError(fn: () => unknown): SpecError {
  try {
    fn();
  } catch (e) {
    if (e instanceof SpecError) return e;
    throw e;
  }
  throw new Error("expected a SpecError");
}

describe("facts", () => {
  test("rank counts strictly better values, so ties share a rank", () => {
    const values = [4120, 2000, 1500, 1200, 930, 500, 100];
    expect(rank(930, values)).toEqual({ n: 5, of: 7, text: "5 of 7", nth: "5th of 7" });
    expect(rank(930, values, "asc").n).toBe(3);
    expect(rank(7, [7, 7, 3]).text).toBe("1 of 3");
  });

  test("ordinal", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });

  test("share and pct keep one decimal below 10%", () => {
    expect(share(930, 10570)).toBe("8.8%");
    expect(share(800, 2667)).toBe("30%");
    expect(share(1, 0)).toBe("—");
    expect(pct(0.04)).toBe("0%");
    expect(pct(8)).toBe("8%");
    expect(pct(-2.25)).toBe("−2.3%");
  });

  test("fmtUnit places units and uses a true minus", () => {
    expect(fmtUnit(930, "signups")).toBe("930 signups");
    expect(fmtUnit(-3190)).toBe("−3,190");
    expect(fmtUnit(1234, "$")).toBe("$1,234");
    expect(fmtUnit(-12000, "€")).toBe("−€12k");
    expect(fmtUnit(8.83, "%")).toBe("8.8%");
    expect(fmtUnit(3.5, "s")).toBe("3.5 s");
    expect(fmtUnit(0.8, "ms", "2")).toBe("0.80 ms");
    expect(fmtUnit(12, "h", "$")).toBe("12 h");
  });

  test("signed, delta and ratio", () => {
    expect(signed(1200)).toBe("+1,200");
    expect(signed(-3190, "signups")).toBe("−3,190 signups");
    expect(signed(40, "$")).toBe("+$40");
    expect(signed(0.2, "h", "int")).toBe("0 h");
    expect(delta(930, 4120)).toBe("−3,190");
    expect(delta(46, 45, "k")).toBe("+1 k");
    expect(ratio(4120, 930)).toBe("4.4×");
    expect(ratio(40, 20)).toBe("2×");
    expect(ratio(2150, 1)).toBe("2,150×");
    expect(ratio(1, 0)).toBe("—");
  });

  test("trend and factList", () => {
    expect([trend(2), trend(-1), trend(0)]).toEqual(["up", "down", "flat"]);
    const rows = factList([{ k: "a", v: "1" }, false, null, { k: "b", v: "" }, ...["c", "d", "e", "f", "g"].map((k) => ({ k, v: k }))]);
    expect(rows.map((r) => r.k)).toEqual(["a", "c", "d", "e", "f"]);
  });

  test("itemInfo and groupInfo carry card fields and drop empty ones", () => {
    const info = itemInfo({
      id: "nl", label: "Newsletter", figure: "f", value: "930",
      facts: [{ k: "Rank", v: "5 of 7" }], links: [{ rel: "Flows to", ids: ["x"], inverse: "Flows from" }, { rel: "Empty", ids: [] }],
      context: [], pos: "5 of 7", crumb: ["root"], say: "Newsletter, 930",
    });
    expect(info).toEqual({
      id: "nl", type: "item", label: "Newsletter", figure: "f", value: "930",
      facts: [{ k: "Rank", v: "5 of 7" }], links: [{ rel: "Flows to", ids: ["x"], inverse: "Flows from" }],
      pos: "5 of 7", crumb: ["root"], say: "Newsletter, 930",
    });
    expect(groupInfo({ id: "web", label: "Web", figure: "f", members: ["a"], value: "45k" })).toEqual({
      id: "web", type: "group", label: "Web", figure: "f", members: ["a"], value: "45k",
    });
  });
});

describe("spec keys", () => {
  test("parseNotes takes {on, text} and plain text", () => {
    expect(parseNotes(undefined)).toEqual([]);
    expect(parseNotes([{ on: "a", text: " Leads. " }, { on: ["a", "b"], text: "Pair." }, "No target."])).toEqual([
      { on: ["a"], text: "Leads." }, { on: ["a", "b"], text: "Pair." }, { on: [], text: "No target." },
    ]);
  });

  test("parseNotes rejects bad shapes and more than 4", () => {
    expect(specError(() => parseNotes(["a", "b", "c", "d", "e"], 7)).line).toBe(7);
    expect(specError(() => parseNotes([{ on: "a", text: "x", tone: "ok" }])).message).toContain("Allowed: on, text");
    specError(() => parseNotes([{ on: "a" }]));
    specError(() => parseNotes([{ on: 3, text: "x" }]));
    specError(() => parseNotes("just text"));
  });

  test("parseCaveat, parseStory, parseUnit", () => {
    expect(parseCaveat(undefined)).toBeUndefined();
    expect(parseCaveat("Excludes refunds.")).toBe("Excludes refunds.");
    specError(() => parseCaveat(3));
    expect(parseStory(["organic", { sel: "paid", cmp: "organic", note: "Paid is half." }])).toEqual([
      { sel: "organic" }, { sel: "paid", cmp: "organic", note: "Paid is half." },
    ]);
    specError(() => parseStory([{ note: "no sel" }]));
    expect(parseUnit("signups")).toBe("signups");
    specError(() => parseUnit("a very long unit name here"));
  });

  test("parseMarks needs exactly one axis and at most 2 lines", () => {
    expect(parseMarks([{ y: "2", label: "SLO" }, { x: "median" }])).toEqual([{ axis: "y", at: 2, label: "SLO" }, { axis: "x", at: "median" }]);
    expect(parseMarks([{ x: new Date("2026-03-01") }])).toEqual([{ axis: "x", at: "2026-03-01" }]);
    specError(() => parseMarks([{ x: 1, y: 2 }]));
    specError(() => parseMarks([{ label: "none" }]));
    specError(() => parseMarks([{ y: 1 }, { y: 2 }, { y: 3 }]));
  });

  test("parseBands", () => {
    expect(parseBands([{ from: 0, to: "4", label: "Within 4 h", axis: "y" }])).toEqual([{ from: 0, to: 4, label: "Within 4 h", axis: "y" }]);
    specError(() => parseBands([{ from: 0, to: 1, axis: "z" }]));
  });

  test("readingSpec and scaleSpec only set present keys", () => {
    expect(readingSpec({ title: "x" })).toEqual({});
    expect(readingSpec({ notes: ["n"], caveat: "c" })).toEqual({ notes: [{ on: [], text: "n" }], caveat: "c" });
    expect(scaleSpec({ unit: "h", marks: [{ y: "mean" }] })).toEqual({ unit: "h", marks: [{ axis: "y", at: "mean" }] });
  });

  test("markValue resolves mean and median", () => {
    expect(markValue(3, [1, 2])).toBe(3);
    expect(markValue("mean", [1, 2, 6])).toBe(3);
    expect(markValue("median", [5, 1, 3])).toBe(3);
    expect(markValue("median", [4, 1, 3, 2])).toBe(2.5);
    expect(markValue("mean", [])).toBe(0);
  });
});

describe("annotations", () => {
  test("refLine draws a y rule with its label above the right end", () => {
    expect(refLine(frame, { y: 50 }, "Target")).toBe(
      '<g class="x-ref-line" data-axis="y"><line class="x-ref-rule" x1="40" y1="50" x2="240" y2="50"/><text class="x-ref-label" x="240" y="46" text-anchor="end">Target</text></g>',
    );
  });

  test("refLine flips an x label that would leave the frame", () => {
    expect(refLine(frame, { x: 60 }, "Launch")).toContain('<text class="x-ref-label" x="64" y="23">Launch</text>');
    expect(refLine(frame, { x: 235 }, "Launch")).toContain('x="231" y="23" text-anchor="end"');
    expect(refLine(frame, { x: 60 }, undefined, { cls: "x-on-sel" })).not.toContain("<text");
  });

  test("refBand orders its span", () => {
    expect(refBand(frame, { y: [80, 30] }, "Normal")).toBe(
      '<g class="x-ref-band" data-axis="y"><rect class="x-ref-band-fill" x="40" y="30" width="200" height="50"/><text class="x-ref-label" x="44" y="45">Normal</text></g>',
    );
  });

  test("notes places numbered markers just outside their target, on free spots", () => {
    const anchors = { a: { x: 100, y: 40, w: 40, h: 20 }, b: { x: 60, y: 70, w: 20, h: 20 } };
    const svg = notes({ id: "f", notes: [{ on: ["a"], text: "1" }, { on: [], text: "2" }, { on: ["zz", "b"], text: "3" }] }, anchors, {
      obstacles: [{ x: 130, y: 30, w: 30, h: 20 }],
      bounds: frame,
    });
    expect(svg).toStartWith('<g class="x-notes" data-for="f" aria-hidden="true">');
    expect(svg.match(/class="x-note-marker"/g)!.length).toBe(2);
    // spots sit around the selection ring (the box plus 5px). Beside a's top-right corner and beside its right edge the
    // obstacle is in the way, so the marker sits above its middle; b's top-right corner would touch a, so it sits beside b
    expect(svg).toContain('<g class="x-note-marker" data-note="1" data-for="a"><circle class="x-note-ring" cx="120" cy="21" r="10"/>');
    expect(svg).toContain('data-note="3" data-for="zz b"><circle class="x-note-ring" cx="99" cy="80" r="10"/>');
    expect(notes({ notes: [{ on: ["missing"], text: "x" }] }, anchors)).toBe("");
    expect(notes({}, anchors)).toBe("");
  });

  test("notes keeps markers inside bounds and apart", () => {
    const edge = { a: { x: 40, y: 10, w: 20, h: 20 } };
    const svg = notes({ notes: [{ on: ["a"], text: "1" }, { on: ["a"], text: "2" }] }, edge, { bounds: frame });
    const centres = [...svg.matchAll(/cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    // above the corner would leave the bounds: beside the right edge, then beside the bottom-right corner
    expect(centres).toEqual([[79, 20], [75, 45]]);
  });

  test("state hooks and the stage", () => {
    expect(onSel("<line/>")).toBe('<g class="x-on-sel"><line/></g>');
    expect(onRel("<line/>")).toBe('<g class="x-on-rel"><line/></g>');
    expect(onHover("x", true)).toBe('<span class="x-on-hover">x</span>');
    expect(stageWrap("<svg></svg>")).toBe('<div class="x-stage"><svg></svg></div>');
  });
});
