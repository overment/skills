import { SpecError, type BlockModule, type DetailBlock } from "../types";
import { isObj } from "./util";

export const detailModule: BlockModule<DetailBlock> = {
  type: "detail",

  normalize(raw) {
    const empty = raw.data == null || (isObj(raw.data) && Object.keys(raw.data).length === 0);
    if (!empty) throw new SpecError("detail takes no fields; leave the fence empty.", raw.line);
    return { type: "detail", line: raw.line };
  },

  render() {
    return `<aside class="x-detail" data-detail data-placement="inline" aria-live="polite"><p class="x-detail-empty">Select any part to see what it does.</p></aside>`;
  },
};
