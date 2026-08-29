/**
 * Deciding what the reflection proposes adding — new notes and new arrows.
 *
 * The ghosts on the canvas are inert; this floating panel is where they are kept or dropped, each
 * on its own or all at once. Adding calls the companion's commit handles, which stamp the note or
 * draw the grey arrow; dismissing just drops the ghost. In the `InFrontOfTheCanvas` layer (screen
 * space, pointer-enabled), it disappears when there is nothing left to decide.
 */
import { useEditor, useValue } from 'tldraw'
import { nodeCenter } from '@/domain'
import { useCanvasDocument } from '@/canvas/adapter/canvasView'
import {
	commitIdeas,
	commitRelations,
	ideaSuggestions,
	relationSuggestions,
} from '@/companion/companionState'
import { caption, panelButton, panelChrome } from '@/canvas/ui/theme'

export function IdeaControls() {
	const editor = useEditor()
	const ideas = useValue(ideaSuggestions)
	const relations = useValue(relationSuggestions)
	const addIdeas = useValue(commitIdeas)
	const addRelations = useValue(commitRelations)
	const canvas = useCanvasDocument()
	// Track the camera so the panel follows its column as the canvas pans and zooms.
	useValue('camera', () => editor.getCamera(), [editor])

	if (ideas.length === 0 && relations.length === 0) return null

	// Anchor near the first pending item — the idea column if there is one, else the first arrow's
	// source note.
	const relationSource = ideas.length === 0 ? canvas.nodes[relations[0].from] : undefined
	const anchorPage =
		ideas.length > 0
			? { x: ideas[0].x, y: ideas[0].y }
			: relationSource
				? nodeCenter(relationSource)
				: { x: 0, y: 0 }
	const anchor = editor.pageToViewport(anchorPage)

	const noteName = (id: string) => canvas.nodes[id]?.content.text?.trim() || 'a note'
	const dismissIdea = (id: string) =>
		ideaSuggestions.set(ideaSuggestions.get().filter((idea) => idea.id !== id))
	const dismissRelation = (id: string) =>
		relationSuggestions.set(relationSuggestions.get().filter((relation) => relation.id !== id))
	const dismissAll = () => {
		ideaSuggestions.set([])
		relationSuggestions.set([])
	}
	const addAll = () => {
		if (ideas.length > 0) addIdeas?.(ideas.map((idea) => idea.id))
		if (relations.length > 0) addRelations?.(relations.map((relation) => relation.id))
	}

	return (
		<div
			data-idea-controls=""
			onPointerDown={(event) => event.stopPropagation()}
			style={{
				...panelChrome,
				position: 'absolute',
				left: anchor.x,
				top: anchor.y,
				transform: 'translate(calc(-100% - 12px), 0)',
				pointerEvents: 'all',
				display: 'flex',
				flexDirection: 'column',
				gap: 'var(--tl-space-2)',
				padding: 'var(--tl-space-3)',
				maxWidth: 300,
			}}
		>
			<span style={caption}>The companion suggests:</span>
			{ideas.map((idea) => (
				<div
					key={idea.id}
					data-idea-row={idea.id}
					style={{ display: 'flex', gap: 'var(--tl-space-2)', alignItems: 'center' }}
				>
					<span style={{ flex: 1 }}>
						{idea.kind === 'question' ? '? ' : ''}
						{idea.text}
						{idea.connectTo ? ` → ${noteName(idea.connectTo)}` : ''}
					</span>
					<button
						type="button"
						data-idea-add=""
						style={panelButton}
						aria-label="Add this idea"
						onClick={() => addIdeas?.([idea.id])}
					>
						✓
					</button>
					<button
						type="button"
						data-idea-dismiss=""
						style={panelButton}
						aria-label="Dismiss this idea"
						onClick={() => dismissIdea(idea.id)}
					>
						✗
					</button>
				</div>
			))}
			{relations.map((relation) => (
				<div
					key={relation.id}
					data-relation-row={relation.id}
					style={{ display: 'flex', gap: 'var(--tl-space-2)', alignItems: 'center' }}
				>
					<span style={{ flex: 1 }}>
						↳ {noteName(relation.from)} → {noteName(relation.to)}
						{relation.label ? ` (${relation.label})` : ''}
					</span>
					<button
						type="button"
						data-relation-add=""
						style={panelButton}
						aria-label="Draw this arrow"
						onClick={() => addRelations?.([relation.id])}
					>
						✓
					</button>
					<button
						type="button"
						data-relation-dismiss=""
						style={panelButton}
						aria-label="Dismiss this arrow"
						onClick={() => dismissRelation(relation.id)}
					>
						✗
					</button>
				</div>
			))}
			<div style={{ display: 'flex', gap: 'var(--tl-space-2)' }}>
				<button type="button" style={panelButton} onClick={addAll}>
					Add all
				</button>
				<button type="button" style={panelButton} onClick={dismissAll}>
					Dismiss all
				</button>
			</div>
		</div>
	)
}
