import { Tldraw, type Editor } from 'tldraw'
import { components, customShapeUtils, customTools, uiOverrides } from '@/canvas/config'

/**
 * Documents are stored in the browser's IndexedDB under this key, so work
 * survives a refresh and syncs between tabs on the same origin. Drop the prop
 * below to start from a blank canvas on every load.
 */
const PERSISTENCE_KEY = 'llm-spatial-context'

function handleMount(editor: Editor) {
	// Prototype logic that needs the editor goes here — this runs once the
	// editor is ready. For example: editor.createShape(...),
	// editor.getCurrentPageShapes(), editor.store.listen(...).

	// Convenience while prototyping: reach the editor from the browser console.
	if (import.meta.env.DEV) {
		;(window as unknown as { editor: Editor }).editor = editor
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
