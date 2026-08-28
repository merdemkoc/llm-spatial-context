/**
 * The whole board, read for the companion.
 *
 * The observer and the grouping suggester both reason about the *whole*
 * arrangement, not just the last change. `buildBoardSummary` is the pure fold that
 * produces that reading; this is the one line that feeds it the live canvas.
 *
 * A canvas concern, like `episodeContext`: `getCanvasDocument` reads the tldraw
 * store, so it lives here in the adapter rather than in the pure domain. Injected
 * into the companion the same way `readEpisodeContext` is.
 */
import type { Editor } from 'tldraw'
import { buildBoardSummary, type BoardSummary } from '@/domain'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'

/** The current whole-board summary, resolved from the live canvas. */
export function readBoardSummary(editor: Editor): BoardSummary {
	return buildBoardSummary(getCanvasDocument(editor))
}
