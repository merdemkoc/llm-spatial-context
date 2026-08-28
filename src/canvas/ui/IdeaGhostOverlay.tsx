/**
 * The reflection's proposed ideas, drawn as ghost notes.
 *
 * When the companion reflects on the board it may propose a few new notes; this previews each
 * where it would land, as a faint agent-accented card carrying its text. Accepting turns it
 * into a real note; dismissing drops it — this only ever shows the proposal.
 *
 * A viewing aid, part of the `OnTheCanvas` composite: it reads the atom, writes nothing, and
 * renders behind the shapes and outside the export path. It wears the agent ink, so a proposed
 * note reads as AI-made the same way an accepted one will.
 */
import { useValue } from 'tldraw'
import { POST_IT_DEFAULT_HEIGHT, POST_IT_DEFAULT_WIDTH } from '@/domain'
import { ideaSuggestions } from '@/companion/companionState'
import { AGENT_INK, agentTint, MONO_FAMILY } from '@/canvas/ui/theme'

export function IdeaGhostOverlay() {
	const ideas = useValue(ideaSuggestions)

	if (ideas.length === 0) return null

	return (
		<>
			{ideas.map((idea) => (
				<div
					key={idea.id}
					data-idea-ghost={idea.id}
					aria-hidden="true"
					style={{
						position: 'absolute',
						left: idea.x,
						top: idea.y,
						width: POST_IT_DEFAULT_WIDTH,
						height: POST_IT_DEFAULT_HEIGHT,
						boxSizing: 'border-box',
						padding: 12,
						// World units (no counter-scaling): the ghost should read like a note at any
						// zoom, since that is what it will become.
						border: `2px dashed ${AGENT_INK}`,
						borderRadius: 6,
						background: agentTint(0.1),
						color: AGENT_INK,
						font: `13px/1.4 ${MONO_FAMILY}`,
						overflow: 'hidden',
						// Never what a click lands on: the decision is made from the controls, not here.
						pointerEvents: 'none',
					}}
				>
					{idea.text}
				</div>
			))}
		</>
	)
}
