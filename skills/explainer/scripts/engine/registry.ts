// Every block type the engine knows. The parser treats exactly these fence languages as blocks.
import { compareModule } from "./blocks/compare.ts";
import { contextModule } from "./blocks/context.ts";
import { detailModule } from "./blocks/detail.ts";
import { glossaryModule } from "./blocks/glossary.ts";
import { matrixModule } from "./blocks/matrix.ts";
import { noteModule } from "./blocks/note.ts";
import { stepsModule } from "./blocks/steps.ts";
import { widgetModule } from "./blocks/widget.ts";
import { figureModule } from "./figure/index.ts";
import { blockModule as bar } from "./charts/bar.ts";
import { blockModule as beeswarm } from "./charts/beeswarm.ts";
import { blockModule as bump } from "./charts/bump.ts";
import { blockModule as dumbbell } from "./charts/dumbbell.ts";
import { blockModule as funnel } from "./charts/funnel.ts";
import { blockModule as heatmap } from "./charts/heatmap.ts";
import { blockModule as line } from "./charts/line.ts";
import { blockModule as marimekko } from "./charts/marimekko.ts";
import { blockModule as polar } from "./charts/polar.ts";
import { blockModule as pyramid } from "./charts/pyramid.ts";
import { blockModule as quadrant } from "./charts/quadrant.ts";
import { blockModule as radar } from "./charts/radar.ts";
import { blockModule as sankey } from "./charts/sankey.ts";
import { blockModule as scatter } from "./charts/scatter.ts";
import { blockModule as slope } from "./charts/slope.ts";
import { blockModule as treemap } from "./charts/treemap.ts";
import { blockModule as venn } from "./charts/venn.ts";
import { blockModule as waterfall } from "./charts/waterfall.ts";
import { blockModule as gantt } from "./plans/gantt.ts";
import { blockModule as journey } from "./plans/journey.ts";
import { blockModule as kanban } from "./plans/kanban.ts";
import { blockModule as storymap } from "./plans/storymap.ts";
import { blockModule as timeline } from "./plans/timeline.ts";
import { blockModule as fishbone } from "./structures/fishbone.ts";
import { blockModule as nested } from "./structures/nested.ts";
import { blockModule as schema } from "./structures/schema.ts";
import { blockModule as swimlane } from "./structures/swimlane.ts";
import { blockModule as uml } from "./structures/uml.ts";
import { blockModule as wardley } from "./structures/wardley.ts";
import { reportModules } from "./report/index.ts";
import type { BlockModule } from "./types.ts";

export const blockModules: Record<string, BlockModule<any>> = {
  figure: figureModule,
  matrix: matrixModule,
  compare: compareModule,
  steps: stepsModule,
  note: noteModule,
  glossary: glossaryModule,
  widget: widgetModule,
  detail: detailModule,
  context: contextModule,
  bar,
  beeswarm,
  bump,
  dumbbell,
  funnel,
  heatmap,
  line,
  marimekko,
  polar,
  pyramid,
  quadrant,
  radar,
  sankey,
  scatter,
  slope,
  treemap,
  venn,
  waterfall,
  gantt,
  journey,
  kanban,
  storymap,
  timeline,
  fishbone,
  nested,
  schema,
  swimlane,
  uml,
  wardley,
  ...Object.fromEntries(reportModules.map((m) => [m.type, m])),
};
