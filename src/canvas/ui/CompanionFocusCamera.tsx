/**
 * The canvas follows what the companion is looking at.
 *
 * `CompanionFocusOverlay` draws the spotlight; this moves the board under it. They read the
 * same atom and are deliberately separate components, because they do opposite things: the
 * overlay is a viewing aid that writes nothing, and this writes the one piece of state the
 * companion is otherwise forbidden to touch. Keeping the write out of the overlay is what lets
 * that file keep saying it renders and nothing more.
 *
 * It renders nothing. It lives in the `OnTheCanvas` composite only because that is where the
 * editor context and the atom already meet — there is no "effects" slot, and inventing one for
 * a single `useEffect` would be a worse trade than this comment.
 *
 * **Three restraints, none of them optional.** It will not move the camera out from under a
 * drag, because that does not annoy the user so much as break the gesture they are in the
 * middle of. It will not zoom in past `MAX_FOCUS_ZOOM`, because "fit these two notes" on two
 * adjacent notes means 600% and a board you no longer recognise. And it honours the reduced
 * motion preference by arriving instantly rather than sliding, since a 500ms camera glide is
 * exactly the kind of motion that setting exists to refuse.
 */
import { useEffect } from 'react'
import { Box, useEditor, useValue } from 'tldraw'
import { nodeIdToShapeId } from '@/canvas/adapter/ids'
import { companionFocus, followEnabled } from '@/companion/companionState'

/**
 * Clearance in screen pixels between the focused notes and the edge of the viewport.
 *
 * Generous, and not symmetrical with anything: the companion's own bar sits over the top of
 * the canvas and the toolbar over the bottom, so a note framed tight against the edge would be
 * framed underneath a panel.
 */
const FOCUS_INSET = 96

/**
 * As far in as following will ever take you.
 *
 * Fitting the subject is the point, but two notes side by side fit a 1400px viewport at about
 * 600%, which is not a view of anything — it is a wall of one word. Past 1:1 the extra scale
 * buys no legibility on a post-it, so that is where it stops and the notes simply sit in the
 * middle with room around them.
 */
const MAX_FOCUS_ZOOM = 1

/** Long enough to read as the board moving rather than cutting; short enough not to be a wait. */
const FOCUS_ANIMATION_MS = 520

export function CompanionFocusCamera() {
	const editor = useEditor()
	const following = useValue(followEnabled)
	// Joined rather than the array itself: the atom holds a fresh array for every remark, so
	// depending on it directly would re-run this on renders that changed nothing.
	const focusKey = useValue(companionFocus).join(' ')

	useEffect(() => {
		if (!following || focusKey === '') return
		// Mid-gesture. Moving the camera now would not interrupt the user, it would drag their
		// note somewhere they never pointed.
		if (editor.inputs.isDragging) return

		const boxes = companionFocus
			.get()
			.map((id) => editor.getShapePageBounds(nodeIdToShapeId(id)))
			.filter((box): box is Box => box !== undefined)
		// Every note the remark named has been deleted since. The overlay draws nothing in this
		// case either; there is no "there" to go to.
		if (boxes.length === 0) return

		const bounds = Box.Common(boxes)
		const viewport = editor.getViewportScreenBounds()
		// The zoom `zoomToBounds` would choose on its own, computed here so it can be capped.
		// Guarded against a zero dimension, which a single unrotated note never has but a
		// degenerate box would.
		const fitZoom = Math.min(
			bounds.width > 0 ? (viewport.width - FOCUS_INSET * 2) / bounds.width : MAX_FOCUS_ZOOM,
			bounds.height > 0 ? (viewport.height - FOCUS_INSET * 2) / bounds.height : MAX_FOCUS_ZOOM
		)

		editor.zoomToBounds(bounds, {
			inset: FOCUS_INSET,
			targetZoom: Math.min(fitZoom, MAX_FOCUS_ZOOM),
			// `getAnimationSpeed` is 0 when the user has asked for reduced motion.
			animation: { duration: editor.user.getAnimationSpeed() === 0 ? 0 : FOCUS_ANIMATION_MS },
		})
	}, [editor, focusKey, following])

	return null
}
