/**
 * Everything drawn on the canvas layer, in one component.
 *
 * tldraw's `OnTheCanvas` slot takes a single component, but two things now live there — the
 * contextual-field circles and the grouping ghost — so this composes them. Both render inside
 * the camera-transformed layer, behind the shapes and outside the export path, so neither
 * covers a note's text or reaches a grounded screenshot. Order here is paint order: fields
 * first, then the ghost over them.
 *
 * One member draws nothing: `CompanionFocusCamera` follows the spotlight with the camera. It
 * is here for the context rather than the layer — see its own note.
 */
import { ContextualFieldOverlay } from '@/canvas/ui/ContextualFieldOverlay'
import { GroupingGhostOverlay } from '@/canvas/ui/GroupingGhostOverlay'
import { IdeaGhostOverlay } from '@/canvas/ui/IdeaGhostOverlay'
import { RelationGhostOverlay } from '@/canvas/ui/RelationGhostOverlay'
import { CompanionFocusOverlay } from '@/canvas/ui/CompanionFocusOverlay'
import { CompanionFocusCamera } from '@/canvas/ui/CompanionFocusCamera'

export function CanvasOverlays() {
	return (
		<>
			<ContextualFieldOverlay />
			<CompanionFocusOverlay />
			{/* Renders nothing — it moves the camera to whatever the overlay above is
			    highlighting. Here because this is where the editor context and the focus atom
			    already meet, not because it draws. */}
			<CompanionFocusCamera />
			<GroupingGhostOverlay />
			<RelationGhostOverlay />
			<IdeaGhostOverlay />
		</>
	)
}
