// Report genre blocks: meta (the line under the title), events (a second-precision trace), change
// (WAS → NOW cards), metrics (before/after with proof) and checklist (try steps and open questions).
// They share one page-wide relation index (common.ts), so a click in one panel lights its counterparts.
import type { BlockModule } from "../types.ts";
import { changeModule } from "./change.ts";
import { checklistModule } from "./checklist.ts";
import { eventsModule } from "./events.ts";
import { metaModule } from "./meta.ts";
import { metricsModule } from "./metrics.ts";

export const reportModules: BlockModule<any>[] = [metaModule, eventsModule, changeModule, metricsModule, checklistModule];
