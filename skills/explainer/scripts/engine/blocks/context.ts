// Context: what a model is sent on each call. One column per call lists every message that call sends, oldest first.
// A message keeps its row in every column, so the columns form a staircase that shows the append-only list growing,
// and a call's reply sits in the row where the next call's first new message appears.
import { BUDGET, SpecError, type BlockModule, type ElementInfo, type Fact, type Link, type ReadingSpec } from "../types.ts";
import { NOTE_R, READING_KEYS, esc, isObj, itemInfo, list, mark, num, number, readingSpec, svgFigure, text, textWidth, wrap } from "../kit.ts";
import { allowKeys, optBool, optString, requireMap, requireString } from "./util.ts";

const ROLES = ["system", "user", "assistant", "tool"] as const;
type Role = (typeof ROLES)[number];
const ROLE_WORD: Record<Role, string> = { system: "System", user: "User", assistant: "Assistant", tool: "Tool" };
const REPLY_WORD = { call: "Tool call", final: "Answer" } as const;
const MAX_CALLS = 5, MAX_MESSAGES = 10, MAX_LINES = 2;

/** Figure width (the card docks beside it), the edge margin, the gap between columns and the padding inside one. */
const W = 960, EDGE = 8, GAP = 16, PAD = 8;
/** Head row, chip padding, gap between rows, and the lane a note marker takes at a chip's right end. */
const HEAD = 40, INSET = 10, ROW_GAP = 8, LANE = NOTE_R * 2 + 8;

interface Msg { id: string; role: Role; text: string; about?: string; tokens?: number; focal: boolean; first: number }
interface Call { id: string; label: string; message?: string; reply: string; final: boolean; about?: string; focal: boolean; sends: number }

export interface ContextBlock extends ReadingSpec {
  type: "context";
  id: string;
  title?: string;
  for?: string;
  line: number;
  messages: Msg[];
  calls: Call[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const tokensOf = (b: ContextBlock, upTo: number) => b.messages.slice(0, upTo).reduce((a, m) => a + (m.tokens ?? 0), 0);
const counted = (b: ContextBlock) => b.messages.length > 0 && b.messages.every((m) => m.tokens !== undefined);
const fmtInt = (v: number) => v.toLocaleString("en-US");

export const contextModule: BlockModule<ContextBlock> = {
  type: "context",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "context", line);
    allowKeys(data, ["id", "title", "for", "items", ...READING_KEYS], "context", line);
    const id = requireString(data, "id", "context", line);
    const where = `context "${id}"`;
    const items = list(data.items, `${where} items`, line);
    const messages: Msg[] = [], calls: Call[] = [];
    const taken = new Set<string>([id]);
    const claim = (x: string, w: string) => {
      if (taken.has(x)) throw new SpecError(`${w}: id "${x}" is used twice; every message and call needs its own id.`, line, "id-unique");
      taken.add(x);
    };
    items.forEach((item, i) => {
      const w = `${where} item ${i + 1}`;
      if (!isObj(item)) throw new SpecError(`${w} must be a message { id, role, text } or a call { call, reply }.`, line);
      if ("call" in item) {
        allowKeys(item, ["call", "label", "message", "reply", "final", "about", "focal"], w, line);
        const cid = requireString(item, "call", w, line);
        claim(cid, w);
        if (!messages.length) throw new SpecError(`${w}: call "${cid}" comes before any message, so it sends nothing. Put the messages it sends above it.`, line);
        if (calls.length && calls[calls.length - 1].sends === messages.length) {
          ctx.warn({ rule: "spec", severity: "warn", message: `${w}: call "${cid}" sends the same messages as the call before it; add what changed between them.`, line });
        }
        calls.push({
          id: cid,
          label: optString(item, "label", w, line) ?? `Call ${calls.length + 1}`,
          message: optString(item, "message", w, line),
          reply: requireString(item, "reply", w, line),
          final: optBool(item, "final", w, line),
          about: optString(item, "about", w, line),
          focal: optBool(item, "focal", w, line),
          sends: messages.length,
        });
      } else {
        allowKeys(item, ["id", "role", "text", "about", "tokens", "focal"], w, line);
        const mid = requireString(item, "id", w, line);
        claim(mid, w);
        const role = requireString(item, "role", w, line);
        if (!(ROLES as readonly string[]).includes(role)) throw new SpecError(`${w}: role "${role}" is not one of ${ROLES.join(", ")}.`, line);
        messages.push({
          id: mid,
          role: role as Role,
          text: requireString(item, "text", w, line),
          about: optString(item, "about", w, line),
          tokens: item.tokens === undefined ? undefined : number(item.tokens, `${w} tokens`, line),
          focal: optBool(item, "focal", w, line),
          first: calls.length,
        });
      }
    });
    if (!calls.length) throw new SpecError(`${where} needs at least one call: { call: call-1, reply: "…" } after the messages it sends.`, line);
    const last = items[items.length - 1];
    if (!isObj(last) || !("call" in last)) throw new SpecError(`${where} must end with a call; messages after the last call are never sent.`, line);
    const finals = calls.filter((c) => c.final);
    if (finals.length > 1 || (finals.length === 1 && !calls[calls.length - 1].final)) {
      ctx.warn({ rule: "spec", severity: "warn", message: `${where}: only the last call can have \`final: true\`; the loop ends at the first reply with no tool call.`, line });
    }
    const withTokens = messages.filter((m) => m.tokens !== undefined).length;
    if (withTokens && withTokens < messages.length) {
      ctx.warn({ rule: "spec", severity: "warn", message: `${where}: give \`tokens\` on every message or on none; ${messages.length - withTokens} have none, so no totals are shown.`, line });
    }
    if (calls.length > MAX_CALLS) ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${calls.length} calls; the budget is ${MAX_CALLS}. Show the first rounds and the last, or split it.`, line });
    if (messages.length > MAX_MESSAGES) ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${messages.length} messages; the budget is ${MAX_MESSAGES}. Merge the ones the reader never tells apart.`, line });
    const focal = [...messages, ...calls].filter((x) => x.focal).length;
    if (focal > BUDGET.focal) ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} items focal; keep it to ${BUDGET.focal}.`, line });
    return { type: "context", id, title: optString(data, "title", where, line), for: optString(data, "for", where, line), line, messages, calls, ...readingSpec(data, line) };
  },

  render(block, ctx) {
    const { theme } = ctx;
    const px = theme.type.nodeSub, tag = theme.type.tag, lineH = Math.round(px * 1.3);
    const { messages, calls } = block;
    const n = calls.length, M = messages.length;
    const colW = Math.floor((W - 2 * EDGE - (n - 1) * GAP) / n);
    const chipW = colW - 2 * PAD;
    const words = [...new Set(messages.map((m) => ROLE_WORD[m.role])), ...calls.map((c) => REPLY_WORD[c.final ? "final" : "call"])];
    // role tags turn 600 with their chip's selection, so they are measured at the bold width
    const roleW = Math.ceil(Math.max(...words.map((wd) => textWidth(wd, tag, "sans") * 1.08))) + 12;

    // notes: a message's marker sits in a lane at its first chip's right end, a call's at its head's right end
    const noteOf = new Map<string, number>();
    (block.notes ?? []).forEach((note, i) => {
      const target = note.on.find((x) => messages.some((m) => m.id === x) || calls.some((c) => c.id === x));
      if (target && !noteOf.has(target)) noteOf.set(target, i + 1);
    });
    const textW = (id?: string) => chipW - 2 * INSET - roleW - (id && noteOf.has(id) ? LANE : 0);
    const fit = (s: string, id?: string) => {
      const lines = wrap(s, textW(id), px);
      if (lines.length > MAX_LINES) {
        ctx.warn({ rule: "label-fit", severity: "warn", message: `Context "${block.id}": "${s}" needs ${lines.length} lines in a column ${Math.round(colW)}px wide; shorten it to about ${MAX_LINES} lines.`, line: block.line });
      }
      return lines;
    };

    // rows: row r holds message r, and the reply of every call that sends exactly r messages
    const msgLines = messages.map((m) => fit(m.text, m.id));
    const replyLines = calls.map((c) => fit(c.reply));
    const rowCount = Math.max(M, ...calls.map((c) => c.sends)) + 1;
    const rowH = Array.from({ length: rowCount }, (_, r) => {
      const inRow = [...(r < M ? [msgLines[r].length] : []), ...calls.filter((c) => c.sends === r).map((c) => replyLines[calls.indexOf(c)].length)];
      return Math.max(32, Math.ceil(((inRow.length ? Math.max(...inRow) : 1) * lineH + 14) / 8) * 8);
    });
    const top = EDGE, rowsTop = top + HEAD;
    const rowY: number[] = [];
    rowH.reduce((y, h, r) => ((rowY[r] = y), y + h + ROW_GAP), rowsTop);
    const lastRow = Math.max(...calls.map((c) => c.sends));
    const footY = rowY[lastRow] + rowH[lastRow] + 20;
    const bottom = footY + 12;
    const colX = (k: number) => EDGE + k * (colW + GAP);
    const totals = counted(block);

    const chipText = (x: number, y: number, h: number, role: string, lines: string[], cls: string) => {
      const first = y + h / 2 - ((lines.length - 1) * lineH) / 2 + px * 0.35;
      return text(x + INSET, y + h / 2 + tag * 0.35, role, "x-context-role") +
        lines.map((ln, i) => text(x + INSET + roleW, first + i * lineH, ln, cls)).join("");
    };

    // calls first: each panel sits under the chips it sends
    const panels = calls.map((c, k) => {
      const x = colX(k), r = c.sends, y = rowY[r], h = rowH[r];
      const prev = k ? calls[k - 1].sends : 0;
      const foot = [plural(c.sends, "message"), totals ? `${fmtInt(tokensOf(block, c.sends))} tokens` : ""].filter(Boolean).join(" · ");
      const parts = [
        `<rect class="x-mark-shape x-context-panel" x="${num(x)}" y="${num(top)}" width="${num(colW)}" height="${num(bottom - top)}" rx="${theme.radius}"/>`,
        text(x + PAD + 2, top + HEAD / 2 + tag * 0.35, c.label, "x-mark-label x-context-head"),
        `<rect class="x-context-reply${c.final ? " is-final" : ""}" x="${num(x + PAD)}" y="${num(y)}" width="${num(chipW)}" height="${num(h)}" rx="${theme.radius}"/>`,
        chipText(x + PAD, y, h, REPLY_WORD[c.final ? "final" : "call"], replyLines[k], "x-context-text x-context-reply-text"),
        text(x + colW - PAD - 2, footY, foot, "x-context-foot", "end"),
      ];
      const value = `${plural(c.sends, "message")}${k ? `, ${c.sends - prev} new` : ""}`;
      return mark({ id: c.id, label: c.label, value, focal: c.focal, cls: "x-context-call", attrs: ` data-nav="${k},0"` }, parts.join(""));
    });

    // messages: one chip per call that sends it; the first copy is the focusable anchor, later copies share its id.
    // Each call's panel and chips share a column group, so a selected call can lift the copies it sends again (CSS).
    const columns = calls.map((c, k) => {
      const x = colX(k) + PAD;
      const chips = messages.slice(0, c.sends).map((m, r) => {
        const fresh = m.first === k;
        const shape = `<rect class="x-mark-shape x-context-chip" x="${num(x)}" y="${num(rowY[r])}" width="${num(chipW)}" height="${num(rowH[r])}" rx="${theme.radius}"/>` +
          chipText(x, rowY[r], rowH[r], ROLE_WORD[m.role], msgLines[r], "x-mark-label x-context-text");
        const cls = `x-context-msg ${fresh ? "is-new" : "is-carried"}`;
        return fresh
          ? mark({ id: m.id, label: m.text, value: ROLE_WORD[m.role], focal: m.focal, cls, attrs: ` data-nav="${k},${r + 1}"` }, shape)
          : `<g class="x-mark ${cls}" data-id="${esc(m.id)}"${m.focal ? ` data-focal="true"` : ""} aria-hidden="true">${shape}</g>`;
      });
      return `<g class="x-context-col">${panels[k]}${chips.join("")}</g>`;
    });

    // note markers, drawn like kit.notes so the client's callouts and the reading panel treat them the same
    const markers: string[] = [];
    for (const [target, nth] of noteOf) {
      const m = messages.findIndex((x) => x.id === target);
      let cx: number, cy: number;
      if (m >= 0) {
        const k = messages[m].first;
        cx = colX(k) + PAD + chipW - INSET - NOTE_R + 2;
        cy = rowY[m] + rowH[m] / 2;
      } else {
        const k = calls.findIndex((c) => c.id === target);
        cx = colX(k) + colW - PAD - NOTE_R;
        cy = top + HEAD / 2;
      }
      const on = (block.notes ?? [])[nth - 1].on.join(" ");
      markers.push(`<g class="x-note-marker" data-note="${nth}" data-for="${esc(on)}"><circle class="x-note-ring" cx="${num(cx)}" cy="${num(cy)}" r="${NOTE_R}"/>${text(cx, cy + tag * 0.35, String(nth), "x-note-num", "middle")}</g>`);
    }
    const notes = markers.length ? `<g class="x-notes" data-for="${esc(block.id)}" aria-hidden="true">${markers.join("")}</g>` : "";

    const lastCall = calls[n - 1];
    return svgFigure({
      id: block.id,
      kind: "context",
      title: block.title,
      label: `Context sent on each of ${plural(n, "call")}`,
      desc: `${plural(n, "call")} to the model. The first sends ${plural(calls[0].sends, "message")}, the last sends ${plural(lastCall.sends, "message")}${lastCall.final ? " and gets the answer" : ""}.`,
      width: W,
      height: bottom + EDGE,
      body: `<g class="x-context">${columns.join("")}</g>${notes}`,
    });
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const { messages, calls } = block;
    const n = calls.length, M = messages.length, totals = counted(block);
    messages.forEach((m, i) => {
      const sentIn = calls.filter((c) => c.sends > i);
      const first = calls[m.first];
      const facts: Fact[] = [
        { k: "First sent in", v: first.label, ref: first.id },
        { k: "Sent in", v: `${sentIn.length} of ${plural(n, "call")}`, raw: sentIn.length },
        ...(m.tokens !== undefined ? [{ k: "Tokens", v: fmtInt(m.tokens), raw: m.tokens }] : []),
      ];
      elements[m.id] = itemInfo({
        id: m.id, label: m.text, figure: block.id, kind: "message", value: ROLE_WORD[m.role], about: m.about,
        facts,
        links: [{ rel: "Sent in", ids: sentIn.map((c) => c.id) }],
        pos: `${i + 1} of ${M} · ${ROLE_WORD[m.role]}`,
        say: `${ROLE_WORD[m.role]} message: ${m.text}, sent in ${sentIn.length} of ${plural(n, "call")}`,
      });
    });
    calls.forEach((c, k) => {
      const prev = calls[k - 1];
      const facts: Fact[] = [
        { k: "Messages sent", v: String(c.sends), raw: c.sends },
        ...(prev ? [{ k: `New since ${prev.label}`, v: String(c.sends - prev.sends), raw: c.sends - prev.sends }] : []),
        { k: "Reply", v: c.final ? "Answer, the loop ends" : `Tool call: ${c.reply}` },
        ...(totals ? [{ k: "Tokens sent", v: fmtInt(tokensOf(block, c.sends)), raw: tokensOf(block, c.sends) }] : []),
      ];
      const links: Link[] = [
        ...(c.message ? [{ rel: "Sent as", ids: [c.message], inverse: "Sends context" }] : []),
        ...(prev ? [{ rel: "‹ Previous call", ids: [prev.id] }] : []),
        ...(k < n - 1 ? [{ rel: "Next call ›", ids: [calls[k + 1].id] }] : []),
      ];
      elements[c.id] = itemInfo({
        id: c.id, label: c.label, figure: block.id, kind: "call", value: plural(c.sends, "message"), about: c.about,
        related: messages.slice(0, c.sends).map((m) => m.id),
        facts, links,
        pos: `${k + 1} of ${n}`,
        say: `${c.label}, sends ${plural(c.sends, "message")}, ${c.final ? "the answer ends the loop" : `replies with a tool call`}`,
      });
    });
    return { elements };
  },

  reading(block) {
    return `Each column is one call to the model and lists every message it sends, oldest first. Outlined messages are new since the previous call and dim ones are sent again; the last row in a column is the model's reply${block.calls.some((c) => c.final) ? ", and the call whose reply is an answer ends the loop" : ""}.`;
  },

  table(block) {
    const totals = counted(block);
    const cell = (m: Msg, k: number, c: { sends: number }) => (c.sends <= block.messages.indexOf(m) ? "" : m.first === k ? "new" : "sent");
    return {
      head: ["Message", "Role", ...block.calls.map((c) => c.label), ...(totals ? ["Tokens"] : [])],
      rows: [
        ...block.messages.map((m) => [m.text, ROLE_WORD[m.role], ...block.calls.map((c, k) => cell(m, k, c)), ...(totals ? [fmtInt(m.tokens ?? 0)] : [])]),
        ["Reply", "", ...block.calls.map((c) => (c.final ? `${c.reply} (answer)` : c.reply)), ...(totals ? [""] : [])],
      ],
    };
  },
};

/** Ids a call points at elsewhere in the document; lint checks they exist. */
export function contextRefs(block: { type: string; calls?: { id: string; message?: string }[]; line: number }): { id: string; from: string; line: number }[] {
  return block.type === "context" ? (block.calls ?? []).filter((c) => c.message).map((c) => ({ id: c.message!, from: c.id, line: block.line })) : [];
}
