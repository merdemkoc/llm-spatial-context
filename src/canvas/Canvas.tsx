import { Tldraw, type Editor } from 'tldraw'
import { spatialEventStream } from '@/domain'
import { components, customShapeUtils, customTools, uiOverrides } from '@/canvas/config'
import { registerNodeMetadata } from '@/canvas/adapter/metadata'
import { registerSpatialEvents } from '@/canvas/adapter/spatialEvents'
import { seedDemoScene } from '@/canvas/dev/seedScenario'

/**
 * Documents are stored in the browser's IndexedDB under this key, so work
 * survives a refresh and syncs between tabs on the same origin. Drop the prop
 * below to start from a blank canvas on every load.
 *
 * Bumped from `llm-spatial-context` when the note-card example was removed:
 * stored records whose shape util is no longer registered fail to load.
 */
const PERSISTENCE_KEY = 'llm-spatial-context-nodes'

function handleMount(editor: Editor) {
	const disposers = [
		registerNodeMetadata(editor),
		// Turns the store's changes into the spatial event stream the Inspector's event log
		// renders. Feeds the module-scope singleton so the panel, reading the same one, sees
		// every event without a shared parent to thread it through.
		registerSpatialEvents(editor, spatialEventStream),
	]

	// Convenience while prototyping: reach the editor from the browser console, seed the
	// demonstration scene, and read the event stream a future AI observer would consume.
	if (import.meta.env.DEV) {
		const globals = window as unknown as {
			editor: Editor
			spatialEvents: typeof spatialEventStream
			seedDemoScene: () => void
		}
		globals.editor = editor
		globals.spatialEvents = spatialEventStream
		globals.seedDemoScene = () => seedDemoScene(editor)
	}

	// Returned to tldraw, which calls it on unmount. Without it, StrictMode's
	// mount→unmount→remount in development would leave a second live store subscription
	// feeding the singleton stream, and every event would be emitted twice.
	return () => {
		for (const dispose of disposers) dispose()
	}
}

export function Canvas() {
	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw
				persistenceKey={PERSISTENCE_KEY}
				shapeUtils={customShapeUtils}
				tools={customTools}
				overrides={uiOverrides}
				components={components}
				onMount={handleMount}
			/>
		</div>
	)
}
