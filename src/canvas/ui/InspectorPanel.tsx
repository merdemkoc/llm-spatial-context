/**
 * Live view of the canonical Canvas, plus JSON export and import.
 *
 * This is the fastest way to see the model actually working: every interaction
 * on the canvas shows up here as a canonical Node, and the JSON that leaves
 * this panel is the same JSON that can rebuild the canvas.
 */
import { useState } from 'react'
import { useEditor } from 'tldraw'
import type { CanvasDocument } from '@/domain'
import { useCanvasDocument } from '@/canvas/adapter/canvasView'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { restoringNodes } from '@/canvas/adapter/metadata'
import { isPostItShape } from '@/canvas/shapes/postItShape'

export function InspectorPanel() {
	const editor = useEditor()
	const canvas = useCanvasDocument()

	const [isOpen, setIsOpen] = useState(false)
	const [draft, setDraft] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const json = JSON.stringify(canvas, null, 2)

	function handleImport() {
		if (draft === null) return

		let parsed: CanvasDocument
		try {
			parsed = JSON.parse(draft) as CanvasDocument
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Invalid JSON')
			return
		}

		if (!parsed?.nodes || typeof parsed.nodes !== 'object') {
			setError('Expected a canvas with a `nodes` object')
			return
		}

		// The mark is what makes the whole import a single undo step — `run`
		// alone only batches the writes, it doesn't open a history boundary.
		// `restoringNodes` keeps the imported timestamps instead of restamping
		// them the way ordinary creation does.
		editor.markHistoryStoppingPoint('import canvas')
		editor.run(() =>
			restoringNodes(() => {
				const existing = editor
					.getCurrentPageShapes()
					.filter(isPostItShape)
					.map((shape) => shape.id)

				if (existing.length) editor.deleteShapes(existing)

				const pageId = editor.getCurrentPageId()
				editor.createShapes(
					Object.values(parsed.nodes).map((node) => ({ ...nodeToShape(node), parentId: pageId }))
				)
			})
		)

		setDraft(null)
		setError(null)
	}

	if (!isOpen) {
		return (
			<div style={{ padding: 8, pointerEvents: 'all' }}>
				<button onClick={() => setIsOpen(true)} style={buttonStyle}>
					Canonical JSON
				</button>
			</div>
		)
	}

	return (
		<div
			onPointerDown={(event) => event.stopPropagation()}
			onWheel={(event) => event.stopPropagation()}
			style={{
				pointerEvents: 'all',
				width: 380,
				maxHeight: '80vh',
				margin: 8,
				padding: 8,
				display: 'flex',
				flexDirection: 'column',
				gap: 8,
				borderRadius: 8,
				background: 'var(--tl-color-panel, #fff)',
				boxShadow: '0 2px 12px rgba(0, 0, 0, 0.2)',
				font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
			}}
		>
			<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
				<strong style={{ flex: 1 }}>
					Canvas · {Object.keys(canvas.nodes).length} node
					{Object.keys(canvas.nodes).length === 1 ? '' : 's'}
				</strong>
				<button onClick={() => navigator.clipboard.writeText(json)} style={buttonStyle}>
					Copy
				</button>
				<button onClick={() => setDraft(draft === null ? json : null)} style={buttonStyle}>
					{draft === null ? 'Import' : 'Cancel'}
				</button>
				<button onClick={() => setIsOpen(false)} style={buttonStyle}>
					Close
				</button>
			</div>

			{draft === null ? (
				<pre style={preStyle}>{json}</pre>
			) : (
				<>
					<textarea
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						spellCheck={false}
						style={{ ...preStyle, resize: 'vertical' }}
					/>
					<button onClick={handleImport} style={buttonStyle}>
						Replace canvas with this JSON
					</button>
				</>
			)}

			{error && <div style={{ color: '#c62828' }}>{error}</div>}
		</div>
	)
}

const buttonStyle: React.CSSProperties = {
	padding: '4px 8px',
	borderRadius: 4,
	border: '1px solid rgba(0, 0, 0, 0.2)',
	background: 'var(--tl-color-panel, #fff)',
	cursor: 'pointer',
	font: 'inherit',
}

const preStyle: React.CSSProperties = {
	flex: 1,
	minHeight: 200,
	margin: 0,
	padding: 8,
	overflow: 'auto',
	whiteSpace: 'pre-wrap',
	wordBreak: 'break-word',
	borderRadius: 4,
	border: '1px solid rgba(0, 0, 0, 0.1)',
	background: 'var(--tl-color-muted-2, #f9f9f9)',
	font: 'inherit',
}
