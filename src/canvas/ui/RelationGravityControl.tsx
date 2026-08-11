/**
 * The relational-gravity control for the selected relation arrows.
 *
 * Presentation only: the editor write lives in `adapter/relations.ts` so it can
 * be tested against a real editor without rendering anything — the same division
 * as `ContextualFieldControl` and `adapter/contextualField.ts`, whose draft
 * mechanics this deliberately mirrors rather than reinventing.
 *
 * What it does *not* offer is a way to clear the value. A relation always has a
 * gravity — drawing the arrow is what set it to 1 — so "no gravity" is not a state
 * to return to, unlike a contextual field, which a node may genuinely not have.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, useValue, type Editor, type TLShapeId } from 'tldraw'
import {
	relationGravity,
	selectedRelationArrowIds,
	setRelationGravity,
} from '@/canvas/adapter/relations'

/** Several selected relations whose gravities disagree. */
const MIXED = 'mixed'

const ID_SEPARATOR = ' '

/** Coarse enough to be usable with a mouse, fine enough to express "about a third". */
const GRAVITY_STEP = 0.05

export function RelationGravityControl() {
	const editor = useEditor()

	// One computed returning a string, not an array: `useValue` compares by
	// identity, so a fresh array on every recomputation would re-render on every
	// unrelated store change. The string doubles as the remount key below.
	const selectionKey = useValue(
		'relation selection',
		() => selectedRelationArrowIds(editor).join(ID_SEPARATOR),
		[editor]
	)

	if (!selectionKey) return null

	// Keyed, so changing the selection remounts and starts a fresh edit against the
	// new targets rather than leaving the previous one's value in the box.
	return <GravityControl key={selectionKey} selectionKey={selectionKey} />
}

function sharedGravity(editor: Editor, ids: TLShapeId[]): number | typeof MIXED {
	const values = ids.map((id) => {
		const shape = editor.getShape(id)
		return shape ? relationGravity(shape) : undefined
	})

	return values.every((value) => value === values[0]) && values[0] !== undefined ? values[0] : MIXED
}

/**
 * Writes a typed gravity. Empty or unparseable is ignored rather than treated as
 * zero: a half-typed number must not be read as "the user says these are barely
 * related", which is a real and very different claim.
 */
function applyDraft(editor: Editor, ids: TLShapeId[], draft: string) {
	const parsed = Number(draft.trim())
	if (draft.trim() === '' || !Number.isFinite(parsed)) return

	setRelationGravity(editor, ids, parsed)
}

function GravityControl({ selectionKey }: { selectionKey: string }) {
	const editor = useEditor()

	// The component is keyed by `selectionKey`, so these ids are fixed for its whole
	// lifetime — which is what makes them safe to commit to later.
	const ids = useMemo(() => selectionKey.split(ID_SEPARATOR) as TLShapeId[], [selectionKey])

	const gravity = useValue('shared gravity', () => sharedGravity(editor, ids), [editor, ids])

	// Typing "0.35" shouldn't be read as 0 on the way there, so edits are held
	// locally and committed on blur, Enter, or unmount.
	const [draft, setDraft] = useState<string | null>(null)

	// Mirrors `draft` into a ref so the unmount cleanup can read the latest value
	// without re-subscribing on every keystroke.
	const pending = useRef<string | null>(null)
	useEffect(() => {
		pending.current = draft
	}, [draft])

	useEffect(() => {
		// Deselecting the arrow unmounts this control, and React tears it down before
		// the input's blur event can fire — so without this, the click that was meant
		// to finish the edit is the click that throws it away.
		return () => {
			if (pending.current !== null) applyDraft(editor, ids, pending.current)
		}
	}, [editor, ids])

	function commitDraft() {
		if (draft === null) return

		applyDraft(editor, ids, draft)
		setDraft(null)
	}

	const displayed = draft ?? (typeof gravity === 'number' ? String(gravity) : '')

	return (
		<div className="tlui-style-panel__section" style={{ padding: '4px 8px' }}>
			<div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Relational gravity</div>
			<input
				type="number"
				min={0}
				max={1}
				step={GRAVITY_STEP}
				value={displayed}
				placeholder={gravity === MIXED ? 'mixed' : ''}
				aria-label="Relational gravity"
				onPointerDown={(event) => event.stopPropagation()}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commitDraft}
				onKeyDown={(event) => {
					if (event.key === 'Enter') commitDraft()
					if (event.key === 'Escape') setDraft(null)
					// Otherwise the canvas would read typing as shortcuts.
					event.stopPropagation()
				}}
				style={{
					width: '100%',
					minWidth: 0,
					padding: '2px 4px',
					borderRadius: 4,
					border: '1px solid rgba(0, 0, 0, 0.2)',
					font: 'inherit',
				}}
			/>
			<div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
				How strongly you say these relate — 0 to 1. Independent of how far apart they are.
			</div>
		</div>
	)
}
