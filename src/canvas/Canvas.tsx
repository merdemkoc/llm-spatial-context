import { Tldraw, type Editor } from 'tldraw'
import { spatialEventStream } from '@/domain'
import { components, customShapeUtils, customTools, uiOverrides } from '@/canvas/config'
import { registerNodeMetadata } from '@/canvas/adapter/metadata'
import { registerSpatialEvents } from '@/canvas/adapter/spatialEvents'
import { readEpisodeContext } from '@/canvas/adapter/episodeContext'
import { readBoardSummary } from '@/canvas/adapter/boardContext'
import { applyGrouping, planGrouping } from '@/canvas/adapter/grouping'
import { seedDemoScene } from '@/canvas/dev/seedScenario'
import { createCompanion } from '@/companion/companion'
import { createHttpObserverClient } from '@/companion/observerClient'
import { createHttpSuggestClient } from '@/companion/suggestClient'
import { createHttpVoiceClient } from '@/companion/voiceClient'
import { acceptGrouping, requestGrouping } from '@/companion/companionState'

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
	// The AI companion: subscribes to the spatial event stream, groups events into interaction
	// episodes, and — when a pause reveals a meaningful change — asks the model whether to speak,
	// and occasionally whether to propose a grouping. The one consumer the stream was built for;
	// talks to the server over /api. Its grouping controls are published to atoms below so the
	// module-scope UI (button, accept control) can reach them.
	const companion = createCompanion({
		stream: spatialEventStream,
		observer: createHttpObserverClient(),
		voice: createHttpVoiceClient(),
		suggest: createHttpSuggestClient(),
		// Resolves the episode's node ids to the notes' own text, plus the relations that
		// already exist, so the observer can talk about ideas rather than shape ids.
		context: (summary) => readEpisodeContext(editor, summary),
		// The whole board as background for the observer, and the input the suggester reasons
		// over, so a remark or a grouping sees the arrangement rather than the last nudge.
		board: () => readBoardSummary(editor),
		// The model names members; these turn that into concrete moves against the live canvas.
		planGrouping: (memberIds) => planGrouping(editor, memberIds),
		applyGrouping: (plan) => applyGrouping(editor, plan),
	})
	requestGrouping.set(companion.requestGrouping)
	acceptGrouping.set(companion.acceptGrouping)

	const disposers = [
		registerNodeMetadata(editor),
		// Turns the store's changes into the spatial event stream the Inspector's event log
		// renders. Feeds the module-scope singleton so the panel, reading the same one, sees
		// every event without a shared parent to thread it through.
		registerSpatialEvents(editor, spatialEventStream),
		() => {
			// Unpublish the handles before tearing the companion down, so the UI can't call into
			// a disposed loop between mounts.
			requestGrouping.set(null)
			acceptGrouping.set(null)
			companion.dispose()
		},
	]

	// Convenience while prototyping: reach the editor from the browser console, seed the
	// demonstration scene, and read the same event stream the companion above consumes.
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
