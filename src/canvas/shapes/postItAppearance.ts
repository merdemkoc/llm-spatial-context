/**
 * How a post-it's provenance reads, apart from the rendering itself.
 *
 * A note the agent authored (`metadata.createdBy === 'agent'`, carried on the shape's meta)
 * gets a heavier border in the agent ink, so it is distinguishable from the user's own notes at
 * a glance. Kept pure and separate from `PostItShapeUtil` so the decision is testable without a
 * live editor.
 */
import { AGENT_INK } from '@/canvas/ui/theme'

/** Whether a `createdBy` marks the note as the agent's. */
export function isAgentAuthored(createdBy: string | undefined): boolean {
	return createdBy === 'agent'
}

/** The note's border: the agent ink and heavier for an agent note, the user's stroke otherwise. */
export function postItBorder(createdBy: string | undefined, stroke: string): string {
	return isAgentAuthored(createdBy) ? `2px solid ${AGENT_INK}` : `1px solid ${stroke}`
}
