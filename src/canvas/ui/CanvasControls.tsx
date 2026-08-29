/**
 * The pointer-enabled controls that float over the canvas, in one component.
 *
 * tldraw's `InFrontOfTheCanvas` slot takes a single component, and two proposals can want it —
 * a grouping's accept/dismiss and a reflection's idea list — so this composes them. Each
 * renders only while its own proposal is pending, and the two never coexist (a new proposal
 * clears the other), so there is no layout contention in practice.
 */
import { GroupingControls } from '@/canvas/ui/GroupingControls'
import { IdeaControls } from '@/canvas/ui/IdeaControls'

export function CanvasControls() {
	return (
		<>
			<GroupingControls />
			<IdeaControls />
		</>
	)
}
