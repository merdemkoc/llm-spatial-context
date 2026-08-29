/**
 * Everything drawn on the canvas layer, in one component.
 *
 * tldraw's `OnTheCanvas` slot takes a single component, but two things now live there — the
 * contextual-field circles and the grouping ghost — so this composes them. Both render inside
 * the camera-transformed layer, behind the shapes and outside the export path, so neither
 * covers a note's text or reaches a grounded screenshot. Order here is paint order: fields
 * first, then the ghost over them.
 */
import { ContextualFieldOverlay } from '@/canvas/ui/ContextualFieldOverlay'
import { GroupingGhostOverlay } from '@/canvas/ui/GroupingGhostOverlay'
import { IdeaGhostOverlay } from '@/canvas/ui/IdeaGhostOverlay'
import { RelationGhostOverlay } from '@/canvas/ui/RelationGhostOverlay'
import { CompanionFocusOverlay } from '@/canvas/ui/CompanionFocusOverlay'

export function CanvasOverlays() {
	return (
		<>
			<ContextualFieldOverlay />
			<CompanionFocusOverlay />
			<GroupingGhostOverlay />
			<RelationGhostOverlay />
			<IdeaGhostOverlay />
		</>
	)
}
