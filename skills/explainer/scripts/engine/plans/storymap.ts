// User story map: backbone activities and their steps across, release slices as bands of story cards below.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type Fact, type NoteSpec, type StoryStep as StoryStepSpec } from "../types.ts";
import { READING_KEYS, esc, groupInfo, htmlFigure, idFrom, itemInfo, list, mark, readingSpec } from "../kit.ts";
import { allowKeys, isObj, joinList, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";

interface StoryStep { id: string; label: string; about?: string; activity: string }
interface StoryActivity { id: string; label: string; about?: string; steps: string[] } // step ids, in order
interface StoryRelease { id: string; label: string; about?: string }
interface Story { id: string; label: string; about?: string; focal: boolean; muted: boolean; step: string; release: string }

interface StorymapBlock {
  type: "storymap";
  id: string;
  title?: string;
  line: number;
  activities: StoryActivity[];
  steps: StoryStep[]; // every step across the map, left to right
  releases: StoryRelease[];
  stories: Story[];   // by release, then step order
  notes?: NoteSpec[];
  caveat?: string;
  story?: StoryStepSpec[];
}

const BLOCK_KEYS = ["id", "title", "activities", "releases", ...READING_KEYS];
const ACTIVITY_KEYS = ["id", "label", "about", "steps"];
const STEP_KEYS = ["id", "label", "about"];
const RELEASE_KEYS = ["id", "label", "about", "stories"];
const STORY_KEYS = ["id", "label", "about", "focal", "muted"];
const LIMITS = { activities: 5, releases: 3, stories: 20, steps: 8 };
/** Most steps the stylesheet can lay out (grid templates exist for 1–12 columns). Past LIMITS.steps the map is wider than the page. */
const MAX_STEPS = 12;

function fields(v: unknown, keys: string[], where: string, line: number): Fields {
  if (typeof v === "string") return { label: v };
  if (!isObj(v)) throw new SpecError(`${where} must be a map { ${keys.join(", ")} } or a label.`, line);
  allowKeys(v, keys, where, line);
  return v;
}

function idPool(block: string, line: number) {
  const taken = new Set<string>([block]);
  return {
    claim(f: Fields, where: string): void {
      const id = optString(f, "id", where, line);
      if (id === undefined) return;
      if (taken.has(id)) throw new SpecError(`${where}: id "${id}" is already used in this block.`, line, "id-unique");
      taken.add(id);
    },
    make(f: Fields, text: string, where: string): string {
      return optString(f, "id", where, line) ?? idFrom(text, taken, `${block}-`);
    },
  };
}

const CORNER = `<div class="x-plan-corner" aria-hidden="true"></div>`;
const count = (n: number) => `${n} stor${n === 1 ? "y" : "ies"}`;

/** Steps a release puts at least one story under, and the ones it leaves empty. */
function coverage(block: StorymapBlock, release: string): { covered: string[]; empty: string[] } {
  const has = new Set(block.stories.filter((k) => k.release === release).map((k) => k.step));
  return { covered: block.steps.filter((s) => has.has(s.id)).map((s) => s.id), empty: block.steps.filter((s) => !has.has(s.id)).map((s) => s.id) };
}

/** Numbered note markers, keyed by the mark they sit on: the first id of each note that this map draws. */
function noteMarks(notes: NoteSpec[] | undefined, drawn: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  (notes ?? []).forEach((n, i) => {
    const on = n.on.find((id) => drawn.has(id));
    if (!on) return;
    out.set(on, (out.get(on) ?? "") + `<span class="x-note-marker x-plan-note" data-note="${i + 1}" data-for="${esc(n.on.join(" "))}" aria-hidden="true">${i + 1}</span>`);
  });
  return out;
}

export const blockModule: BlockModule<StorymapBlock> = {
  type: "storymap",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "storymap", line);
    allowKeys(data, BLOCK_KEYS, "storymap", line);
    const id = requireString(data, "id", "storymap", line);
    const where = `storymap "${id}"`;

    const actF = list(data.activities, `${where} activities`, line).map((v, i) => fields(v, ACTIVITY_KEYS, `${where} activity ${i + 1}`, line));
    if (!actF.length) throw new SpecError(`${where} needs at least one activity.`, line);
    const stepF = actF.map((f, a) => {
      const aw = `${where} activity ${a + 1}`;
      const steps = list(f.steps, `${aw} steps`, line).map((v, s) => fields(v, STEP_KEYS, `${aw} step ${s + 1}`, line));
      if (!steps.length) throw new SpecError(`${aw} needs at least one step.`, line);
      return steps;
    });
    const total = stepF.reduce((n, s) => n + s.length, 0);
    if (total > MAX_STEPS) {
      throw new SpecError(`${where} has ${total} steps; a story map holds at most ${MAX_STEPS}. Split it into one map per activity group.`, line);
    }

    const relF = list(data.releases, `${where} releases`, line).map((v, i) => fields(v, RELEASE_KEYS, `${where} release ${i + 1}`, line));
    if (!relF.length) throw new SpecError(`${where} needs at least one release.`, line);
    const storyF = relF.map((f, r): [string, Fields[]][] => {
      const rw = `${where} release ${r + 1}`;
      if (f.stories === undefined) return [];
      const byKey = requireMap(f.stories, `${rw} stories`, line);
      return Object.entries(byKey).map(([key, v]): [string, Fields[]] => [
        key,
        list(v, `${rw} stories under "${key}"`, line).map((s, i) => fields(s, STORY_KEYS, `${rw} story ${i + 1} under "${key}"`, line)),
      ]);
    });

    const pool = idPool(id, line);
    actF.forEach((f, a) => {
      pool.claim(f, `${where} activity ${a + 1}`);
      stepF[a].forEach((s, i) => pool.claim(s, `${where} activity ${a + 1} step ${i + 1}`));
    });
    relF.forEach((f, r) => pool.claim(f, `${where} release ${r + 1}`));
    storyF.forEach((groups, r) => groups.forEach(([key, items]) => items.forEach((s, i) => pool.claim(s, `${where} release ${r + 1} story ${i + 1} under "${key}"`))));

    const steps: StoryStep[] = [];
    const activities = actF.map((f, a): StoryActivity => {
      const aw = `${where} activity ${a + 1}`;
      const label = requireString(f, "label", aw, line);
      const aid = pool.make(f, label, aw);
      const own = stepF[a].map((s, i) => {
        const sw = `${aw} step ${i + 1}`;
        const sl = requireString(s, "label", sw, line);
        if (steps.some((o) => o.label === sl)) {
          throw new SpecError(`${where} has two steps labelled "${sl}"; stories are filed by step label, so rename one.`, line, "label-duplicate");
        }
        const step: StoryStep = { id: pool.make(s, sl, sw), label: sl, about: optString(s, "about", sw, line), activity: aid };
        steps.push(step);
        return step.id;
      });
      return { id: aid, label, about: optString(f, "about", aw, line), steps: own };
    });

    const stories: Story[] = [];
    const releases = relF.map((f, r): StoryRelease => {
      const rw = `${where} release ${r + 1}`;
      const label = requireString(f, "label", rw, line);
      const rid = pool.make(f, label, rw);
      const byStep = new Map<string, Fields[]>();
      for (const [key, items] of storyF[r]) {
        const step = steps.find((s) => s.id === key) ?? steps.find((s) => s.label === key);
        if (!step) {
          throw new SpecError(`${rw} files stories under "${key}", which is not a step. Steps: ${joinList(steps.map((s) => s.label))}.`, line, "ref-exists");
        }
        if (byStep.has(step.id)) throw new SpecError(`${rw} lists stories for step "${step.label}" twice; put them in one list.`, line);
        byStep.set(step.id, items);
      }
      for (const step of steps) {
        (byStep.get(step.id) ?? []).forEach((s, i) => {
          const sw = `${rw} story ${i + 1} under "${step.label}"`;
          const sl = requireString(s, "label", sw, line);
          stories.push({
            id: pool.make(s, sl, sw),
            label: sl,
            about: optString(s, "about", sw, line),
            focal: optBool(s, "focal", sw, line),
            muted: optBool(s, "muted", sw, line),
            step: step.id,
            release: rid,
          });
        });
      }
      return { id: rid, label, about: optString(f, "about", rw, line) };
    });

    const budget = (message: string) => ctx.warn({ rule: "budget-nodes", severity: "warn", message, line });
    if (activities.length > LIMITS.activities) budget(`${where} has ${activities.length} activities; keep it to ${LIMITS.activities}. Merge activities the user sees as one, or make one map per part of the product.`);
    if (releases.length > LIMITS.releases) budget(`${where} has ${releases.length} releases; keep it to ${LIMITS.releases}. Fold everything after the next two into one "Later" band.`);
    if (stories.length > LIMITS.stories) budget(`${where} has ${stories.length} stories; keep it to ${LIMITS.stories}. Merge stories that ship together, or split the map by activity.`);
    if (steps.length > LIMITS.steps) budget(`${where} has ${steps.length} steps; keep it to ${LIMITS.steps}, or the map is wider than the page and scrolls sideways. Merge steps the user does in one go, or make one map per activity group.`);
    // the first release has to be a thin slice through the whole backbone
    const first = releases[0];
    const gaps = steps.filter((st) => !stories.some((k) => k.release === first.id && k.step === st.id));
    if (releases.length > 1 && gaps.length && gaps.length < steps.length) {
      ctx.warn({ rule: "spec", severity: "warn", line, message: `${where}: the first release "${first.label}" has no story under ${joinList(gaps.map((st) => `"${st.label}"`))}, so it is not a slice through every step. Add the smallest story there, or say in the prose why it waits.` });
    }
    const focal = stories.filter((s) => s.focal).length;
    if (focal > BUDGET.focal) ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} stories focal; keep it to ${BUDGET.focal}.`, line });

    return { type: "storymap", id, title: optString(data, "title", where, line), line, activities, steps, releases, stories, ...readingSpec(data, line) };
  },

  render(block) {
    const drawn = new Set([...block.activities.map((a) => a.id), ...block.steps.map((st) => st.id), ...block.releases.map((r) => r.id), ...block.stories.map((k) => k.id)]);
    const markers = noteMarks(block.notes, drawn);
    // the marker lane: note markers and the docked card's pin; after a head's label, floated into a card's first line
    const note = (id: string) => `<span class="x-plan-lane" aria-hidden="true"><span class="x-plan-pin"></span>${markers.get(id) ?? ""}</span>`;
    const parts = [CORNER];
    let col = 0;
    for (const a of block.activities) {
      parts.push(mark(
        { id: a.id, label: a.label, cls: "x-board-head x-plan-head x-storymap-activity", attrs: (a.steps.length > 1 ? ` data-span="${a.steps.length}"` : "") + ` data-nav="0,${col}"` },
        `<span class="x-mark-shape x-plan-head-label">${esc(a.label)}</span>${note(a.id)}`,
        true,
      ));
      col += a.steps.length;
    }
    parts.push(CORNER);
    block.steps.forEach((s, i) => {
      parts.push(mark({ id: s.id, label: s.label, cls: "x-board-head x-plan-head x-storymap-step", attrs: ` data-nav="1,${i}"` }, `<span class="x-mark-shape x-plan-head-label">${esc(s.label)}</span>${note(s.id)}`, true));
    });
    block.releases.forEach((r, ri) => {
      const own = block.stories.filter((k) => k.release === r.id);
      // the line under the first release is the release cut: what ships first sits above it
      parts.push(ri === 1
        ? `<div class="x-plan-divider x-storymap-cut" aria-hidden="true"><span class="x-storymap-cut-tag">release cut</span></div>`
        : `<div class="x-plan-divider" aria-hidden="true"></div>`);
      const cells = [mark(
        { id: r.id, label: r.label, value: count(own.length), cls: "x-board-head x-plan-rowhead x-storymap-release", attrs: ` data-nav="${ri + 2},-1"` },
        `<span class="x-plan-rowhead-line"><span class="x-mark-shape x-plan-rowhead-label">${esc(r.label)}</span>${note(r.id)}</span>`,
        true,
      )];
      block.steps.forEach((s, i) => {
        const cards = own.filter((k) => k.step === s.id).map((k) => mark(
          { id: k.id, label: k.label, focal: k.focal, cls: "x-card x-plan-card", attrs: (k.muted ? ` data-muted="true"` : "") + ` data-nav="${ri + 2},${i}"` },
          `<span class="x-plan-line">${note(k.id)}<span class="x-mark-shape x-card-label">${esc(k.label)}</span></span>`,
          true,
        ));
        // an empty step shows "no story" while its release is selected: the thin-slice check
        cells.push(cards.length ? `<div class="x-plan-cell">${cards.join("")}</div>` : `<div class="x-plan-cell" data-empty="true"><span class="x-on-sel x-storymap-gap">no story</span></div>`);
      });
      parts.push(`<div class="x-storymap-row" data-release="${esc(r.id)}">${cells.join("")}</div>`);
    });
    return htmlFigure({
      id: block.id,
      kind: "storymap",
      title: block.title,
      cls: "x-plan",
      label: `Story map: ${joinList(block.activities.map((a) => a.label))}, in ${block.releases.length} release${block.releases.length === 1 ? "" : "s"}`,
      body: `<div class="x-plan-grid x-storymap" data-cols="${block.steps.length}">${parts.join("")}</div>`,
    });
  },

  model(block) {
    const figure = block.id;
    const elements: Record<string, ElementInfo> = {};
    const total = block.steps.length;
    const stepLabel = new Map(block.steps.map((s) => [s.id, s.label]));
    const names = (ids: string[]) => joinList(ids.map((i) => stepLabel.get(i)!));
    for (const a of block.activities) {
      const stories = block.stories.filter((k) => a.steps.includes(k.step));
      const facts: Fact[] = [{ k: "Steps", v: names(a.steps) }];
      for (const r of block.releases) {
        const n = stories.filter((k) => k.release === r.id).length;
        facts.push({ k: r.label, v: count(n), ref: r.id, raw: n });
      }
      elements[a.id] = groupInfo({
        id: a.id, label: a.label, figure, members: [...a.steps, ...stories.map((k) => k.id)], kind: "activity", about: a.about,
        value: `${a.steps.length} step${a.steps.length === 1 ? "" : "s"} · ${count(stories.length)}`,
        facts, links: [{ rel: "Steps", ids: a.steps }],
        say: `${a.label}, ${a.steps.length} steps, ${count(stories.length)}`,
      });
    }
    block.steps.forEach((s, i) => {
      const activity = block.activities.find((a) => a.id === s.activity)!;
      const stories = block.stories.filter((k) => k.step === s.id);
      const firstIn = block.releases.find((r) => stories.some((k) => k.release === r.id));
      elements[s.id] = groupInfo({
        id: s.id, label: s.label, figure, members: stories.map((k) => k.id), kind: "step", about: s.about,
        value: count(stories.length), pos: `${i + 1} of ${total}`, crumb: [activity.id],
        facts: [{ k: "First in", v: firstIn ? firstIn.label : "no release yet", ...(firstIn ? { ref: firstIn.id } : {}) }],
        links: block.releases.map((r) => ({ rel: r.label, ids: stories.filter((k) => k.release === r.id).map((k) => k.id) })),
        say: `${activity.label} › ${s.label}, ${count(stories.length)}`,
      });
    });
    block.releases.forEach((r, ri) => {
      const members = block.stories.filter((k) => k.release === r.id).map((k) => k.id);
      const { covered, empty } = coverage(block, r.id);
      elements[r.id] = groupInfo({
        id: r.id, label: r.label, figure, members, kind: "release", about: r.about,
        value: `${count(members.length)} · covers ${covered.length} of ${total} steps`,
        pos: `${ri + 1} of ${block.releases.length}`,
        // the value carries the coverage; the steps it skips are chips, so each one can be opened
        links: [{ rel: "Leaves empty", ids: empty }],
        say: `${r.label}, ${count(members.length)}, covers ${covered.length} of ${total} steps`,
      });
    });
    for (const k of block.stories) {
      const step = block.steps.find((s) => s.id === k.step)!;
      const activity = block.activities.find((a) => a.id === step.activity)!;
      const release = block.releases.find((r) => r.id === k.release)!;
      const siblings = block.stories.filter((o) => o.step === k.step && o.id !== k.id);
      elements[k.id] = itemInfo({
        id: k.id, label: k.label, figure, kind: "story", about: k.about,
        related: [k.step, k.release],
        context: siblings.map((o) => o.id),
        crumb: [activity.id, step.id],
        facts: [
          { k: "Release", v: release.label, ref: release.id },
          { k: "Same step", v: siblings.length ? siblings.map((o) => `${o.label} (${block.releases.find((r) => r.id === o.release)!.label})`).join(", ") : "none" },
        ],
        say: `${k.label}, ${release.label}, under ${activity.label} › ${step.label}`,
      });
    }
    return { elements };
  },

  reading(block) {
    const parts = ["Activities and their steps run left to right in the order the user does them; each band below is a release, top to bottom by when it ships."];
    if (block.releases.length > 1) parts.push(`The heavy line is the release cut: ${block.releases[0].label} is everything above it, and it should reach every step.`);
    return parts.join(" ");
  },

  table(block) {
    const step = new Map(block.steps.map((s) => [s.id, s]));
    const activity = new Map(block.activities.map((a) => [a.id, a.label]));
    const release = new Map(block.releases.map((r) => [r.id, r.label]));
    return {
      head: ["Story", "Release", "Activity", "Step"],
      rows: block.stories.map((k) => [k.label, release.get(k.release)!, activity.get(step.get(k.step)!.activity)!, step.get(k.step)!.label]),
    } satisfies DataTable;
  },
};
