/**
 * Feeds the event stream from a live editor.
 *
 * This is the one place `canvasDiff` — pure, and until now only exercised by its own
 * test — is driven by real edits. It holds the previous canonical document, re-derives
 * the current one on every document-scope store change, diffs the two, and pushes the
 * resulting events onto the stream. That is the whole of the "wire the change engine to
 * live edits" work: the derivation stays pure in `src/domain`, and only the snapshot
 * bookkeeping and the store subscription live here, in the adapter.
 *
 * Nothing here computes meaning. It observes the same document the Inspector renders and
 * re-states its changes as events, so the canvas remains the single source of truth.
 */
import type { Editor } from 'tldraw'
import { deriveEvents, diffCanvas, type SpatialEventStream } from '@/domain'
import { getCanvasDocument } from '@/canvas/adapter/canvasView'

/**
 * Start emitting spatial events for `editor` onto `stream`. Returns a dispose function
 * that stops the subscription.
 *
 * `scope: 'document'` keeps camera moves, selection and other session state out: those
 * change nothing the canonical document reports, so diffing on them would be wasted work
 * and every one would produce an empty diff anyway. Source is left unfiltered, so a
 * change arriving from another tab is observed too — a remote move is a real move.
 *
 * `previous` is always advanced to the latest document, even when a change produced no
 * events (a sub-pixel drag the document rounds away), so the next diff is always taken
 * against what the reader last saw rather than a stale snapshot.
 */
export function registerSpatialEvents(editor: Editor, stream: SpatialEventStream): () => void {
	let previous = getCanvasDocument(editor)

	return editor.store.listen(
		() => {
			const next = getCanvasDocument(editor)
			const events = deriveEvents(diffCanvas(previous, next))
			previous = next
			stream.emit(events)
		},
		{ scope: 'document' }
	)
}
