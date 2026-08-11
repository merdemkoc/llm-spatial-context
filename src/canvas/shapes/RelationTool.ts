/**
 * Drag from one post-it to another to say they are related.
 *
 * The tool is ours; the shape is tldraw's. `ArrowShapeTool` is a five-line
 * `StateNode` whose `idle` and `pointing` children own the whole interaction —
 * drag-to-connect, binding to whatever is under the cursor, precise anchors,
 * elbow routing, arrowheads, label editing, re-routing when a note moves.
 * Subclassing it inherits all of that; writing a `relation` shape from scratch
 * would mean reimplementing `ArrowShapeUtil` to arrive back at an arrow.
 *
 * So a relation *is* a native arrow. What distinguishes it from a decorative one
 * is `meta.relation`, stamped by `getInitialMetaForShape` in
 * `adapter/metadata.ts` while this tool is the current one — which is why the
 * tool needs its own id and nothing else.
 */
import { ArrowShapeTool } from 'tldraw'

export const RELATION_TOOL_ID = 'relation'

export class RelationTool extends ArrowShapeTool {
	static override id = RELATION_TOOL_ID
}
