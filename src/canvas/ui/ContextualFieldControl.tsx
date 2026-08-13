/**
 * The contextual-field radius control for the current selection.
 *
 * Presentation only: the editor write lives in `adapter/contextualField.ts` so
 * it can be tested against a real editor without rendering anything.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, useValue, type Editor, type TLShapeId } from 'tldraw'
import { readNodeContextualField } from '@/canvas/adapter/adapter'
import { selectedPostItIds, setContextualFieldRadius } from '@/canvas/adapter/contextualField'
import { caption, numberInput, panelButton } from '@/canvas/ui/theme'

/**
 * Suggested starting radius for a field the user is switching on. It lives here
 * and not in `src/domain` on purpose: the model must never apply a radius
 * implicitly, so this is a UI convenience and nothing more.
 */
export const SUGGESTED_RADIUS = 500

/** Several selected post-its whose radii disagree. */
const MIXED = 'mixed'

const ID_SEPARATOR = ' '

export function ContextualFieldControl() {
	const editor = useEditor()

	// One computed, returning a string rather than an array: `useValue` compares
	// by identity, and a fresh array every recomputation would re-render on every
	// unrelated store change. The string doubles as the remount key below.
	const selectionKey = useValue(
		'post-it selection',
		() => selectedPostItIds(editor).join(ID_SEPARATOR),
		[editor]
	)

	if (!selectionKey) return null

	// Keyed, so changing the selection remounts and starts a fresh edit against
	// the new targets rather than leaving the previous one's value in the box.
	return <RadiusControl key={selectionKey} selectionKey={selectionKey} />
}

/**
 * `null` means every target has no field — distinct from a radius of `0`, which
 * is a field that reaches nowhere.
 */
function sharedRadius(editor: Editor, ids: TLShapeId[]): number | null | typeof MIXED {
	const radii = ids.map((id) => readNodeContextualField(editor.getShape(id)?.meta)?.radius ?? null)

	return radii.every((radius) => radius === radii[0]) ? radii[0] : MIXED
}

/**
 * Writes a typed radius. Empty means "clear the field"; anything unparseable is
 * rejected rather than treated as a clear, so a typo can't silently delete one.
 */
function applyDraft(editor: Editor, ids: TLShapeId[], draft: string) {
	const trimmed = draft.trim()
	if (trimmed === '') {
		setContextualFieldRadius(editor, ids, null)
		return
	}

	const parsed = Number(trimmed)
	if (!Number.isFinite(parsed)) return

	setContextualFieldRadius(editor, ids, parsed)
}

/**
 * Sets the radius on the post-its it was mounted for, or clears the field.
 *
 * Clearing is a real operation rather than setting zero: "this node has no
 * context to give" and "its context reaches zero units" are different claims,
 * and the model keeps them apart.
 */
function RadiusControl({ selectionKey }: { selectionKey: string }) {
	const editor = useEditor()

	// The component is keyed by `selectionKey`, so these ids are fixed for its
	// whole lifetime — which is what makes them safe to commit to later.
	const ids = useMemo(() => selectionKey.split(ID_SEPARATOR) as TLShapeId[], [selectionKey])

	const radius = useValue('shared radius', () => sharedRadius(editor, ids), [editor, ids])

	// Typing "12" shouldn't be read as a radius of 1 and then 12 on the way to
	// 120, so edits are held locally and committed on blur, Enter, or unmount.
	const [draft, setDraft] = useState<string | null>(null)

	// Mirrors `draft` into a ref so the unmount cleanup below can read the latest
	// value without re-subscribing on every keystroke.
	const pending = useRef<string | null>(null)
	useEffect(() => {
		pending.current = draft
	}, [draft])

	useEffect(() => {
		// Deselecting the post-it unmounts this control, and React tears it down
		// before the input's blur event can fire — so without this, the click that
		// was meant to finish the edit is the click that throws it away. That is
		// the failure that made "I set 500 and nothing happened" possible.
		return () => {
			if (pending.current !== null) applyDraft(editor, ids, pending.current)
		}
	}, [editor, ids])

	function commit(next: number | null) {
		// `ids`, not the live selection: by the time a blur fires, the click that
		// caused it has usually changed the selection already.
		setContextualFieldRadius(editor, ids, next)
		setDraft(null)
	}

	function commitDraft() {
		if (draft === null) return

		applyDraft(editor, ids, draft)
		setDraft(null)
	}

	const displayed = draft ?? (typeof radius === 'number' ? String(radius) : '')

	return (
		<div
			className="tlui-style-panel__section"
			style={{ padding: 'var(--tl-space-2) var(--tl-space-3)' }}
		>
			<div style={{ ...caption, marginBottom: 'var(--tl-space-2)' }}>Contextual field radius</div>
			<div style={{ display: 'flex', gap: 'var(--tl-space-2)', alignItems: 'center' }}>
				<input
					type="number"
					min={0}
					step={10}
					value={displayed}
					placeholder={radius === MIXED ? 'mixed' : 'none'}
					aria-label="Contextual field radius"
					onPointerDown={(event) => event.stopPropagation()}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commitDraft}
					onKeyDown={(event) => {
						if (event.key === 'Enter') commitDraft()
						if (event.key === 'Escape') setDraft(null)
						// Otherwise the canvas would read typing as shortcuts.
						event.stopPropagation()
					}}
					style={{ ...numberInput, flex: 1 }}
				/>
				<button
					title={
						radius === null
							? `Give the selection a ${SUGGESTED_RADIUS}px field`
							: 'Remove the contextual field'
					}
					onPointerDown={(event) => event.stopPropagation()}
					onClick={() => commit(radius === null ? SUGGESTED_RADIUS : null)}
					style={{ ...panelButton, padding: '2px var(--tl-space-3)' }}
				>
					{radius === null ? 'Add' : 'Clear'}
				</button>
			</div>
		</div>
	)
}
