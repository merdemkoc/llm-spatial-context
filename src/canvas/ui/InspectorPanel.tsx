/**
 * Live view of the canonical Canvas, plus JSON export and import, plus the two
 * strength signals side by side: the gravity the user gave each relation, and the
 * spatial influence derived from the layout — and then, third, what the two make
 * together.
 *
 * This is the fastest way to see the model actually working: every interaction
 * on the canvas shows up here as a canonical Node, and the JSON that leaves
 * this panel is the same JSON that can rebuild the canvas.
 *
 * The influence table is deliberately *beside* the JSON rather than in it.
 * Influence is derived, never persisted — recomputed from geometry on every
 * render, which is why dragging a node changes it with no stored state to
 * invalidate.
 */
import { useState } from 'react'
import { useEditor } from 'tldraw'
import type { CanvasDocument, CanvasNode, SpatialInfluence } from '@/domain'
import { DEFAULT_STRATEGY } from '@/domain'
import { useCanvasDocument } from '@/canvas/adapter/canvasView'
import { nodeToShape } from '@/canvas/adapter/adapter'
import { restoringNodes } from '@/canvas/adapter/metadata'
import { createRelations, isRelationArrow } from '@/canvas/adapter/relations'
import { isPostItShape } from '@/canvas/shapes/postItShape'
import { exportGroundedScreenshot } from '@/canvas/grounding/groundedExport'

export function InspectorPanel() {
	const editor = useEditor()
	const canvas = useCanvasDocument()

	const [isOpen, setIsOpen] = useState(false)
	const [draft, setDraft] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [isGrounding, setIsGrounding] = useState(false)

	const json = JSON.stringify(canvas, null, 2)
	const nodeCount = Object.keys(canvas.nodes).length

	/**
	 * Rasterising is slow enough to be visible, and the failure modes are real
	 * (a tainted canvas, an image tldraw couldn't build), so the state goes to
	 * the panel's existing error line rather than to a console nobody reads.
	 */
	async function handleGroundedScreenshot() {
		setIsGrounding(true)
		setError(null)

		try {
			await exportGroundedScreenshot(editor)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Could not export a grounded screenshot')
		} finally {
			setIsGrounding(false)
		}
	}

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
				// Relation arrows go too. Leaving them would strand every one of them:
				// their bindings die with the notes they pointed at, so they'd persist as
				// dangling lines describing nothing.
				const existing = editor
					.getCurrentPageShapes()
					.filter((shape) => isPostItShape(shape) || isRelationArrow(shape))
					.map((shape) => shape.id)

				if (existing.length) editor.deleteShapes(existing)

				const pageId = editor.getCurrentPageId()
				editor.createShapes(
					Object.values(parsed.nodes).map((node) => ({ ...nodeToShape(node), parentId: pageId }))
				)

				// After the nodes, necessarily: an arrow can only bind to shapes that
				// already exist.
				if (parsed.relations) createRelations(editor, parsed.relations, parsed.nodes)
			})
		)

		setDraft(null)
		setError(null)
	}

	if (!isOpen) {
		return (
			// The pointer-down guard matters as much as the click handler: without it
			// the event reaches the canvas and clears the selection, which tears down
			// whatever selection-scoped control the user was mid-edit in.
			<div
				onPointerDown={(event) => event.stopPropagation()}
				style={{ padding: 8, pointerEvents: 'all' }}
			>
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
				// Three collapsible sections can outgrow `maxHeight`, and without this the
				// overflow renders *outside* the panel's own background rather than
				// scrolling inside it. `onWheel` above already keeps the scroll from
				// reaching the canvas and zooming it.
				overflowY: 'auto',
				borderRadius: 8,
				background: 'var(--tl-color-panel, #fff)',
				boxShadow: '0 2px 12px rgba(0, 0, 0, 0.2)',
				font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
			}}
		>
			<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
				<strong style={{ flex: 1 }}>
					Canvas · {nodeCount} node{nodeCount === 1 ? '' : 's'}
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

			{/* Its own row: the label has to say what comes out, and there is no room
			    for that beside three other buttons in a 380px panel. */}
			<button
				onClick={handleGroundedScreenshot}
				disabled={isGrounding || nodeCount === 0}
				title="A PNG of the canvas with every node outlined and labelled, plus this JSON with an N1/N2/N3 → node id map"
				style={buttonStyle}
			>
				{isGrounding ? 'Rendering…' : 'Grounded screenshot · PNG + JSON'}
			</button>

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

			{/* Relations above influence, following the document's own key order: what
			    the user said, then what the layout implies. Two tables rather than one
			    joined table on purpose — a shared row would suggest the two numbers
			    belong to the same scale.

			    The combination comes third, after both of its inputs, so it reads as a
			    conclusion drawn from the two tables above rather than as a replacement
			    for either. */}
			<RelationSection canvas={canvas} />
			<InfluenceSection canvas={canvas} />
			<EffectiveStrengthSection canvas={canvas} />
		</div>
	)
}

/**
 * Every explicit relation, strongest first.
 *
 * Sits beside the influence table rather than in it. A relation's gravity and a
 * pair's spatial influence are both 0–1 and mean entirely different things — one
 * is what the user asserted, the other is what the geometry implies — so they are
 * shown as two answers, never averaged into one.
 */
function RelationSection({ canvas }: { canvas: CanvasDocument }) {
	const [isOpen, setIsOpen] = useState(true)

	// Read from the document, like the influence table: the numbers here and the
	// JSON above are then the same values by construction.
	const relations = Object.values(canvas.relations)
	const sorted = [...relations].sort((a, b) => b.gravity - a.gravity)

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			<button onClick={() => setIsOpen(!isOpen)} style={buttonStyle}>
				{isOpen ? '▾' : '▸'} Relational gravity · {relations.length} relation
				{relations.length === 1 ? '' : 's'}
			</button>

			{isOpen && (
				<div style={{ ...preStyle, minHeight: 0, maxHeight: 160 }}>
					{relations.length === 0 ? (
						<span style={{ opacity: 0.6 }}>
							Nothing connected yet. Drag between two post-its with the <strong>Relation</strong>{' '}
							tool (<kbd>r</kbd>) — proximity never becomes a relation.
						</span>
					) : (
						<table style={{ width: '100%', borderCollapse: 'collapse' }}>
							<thead>
								<tr style={{ opacity: 0.6, textAlign: 'left' }}>
									<th>source → target</th>
									<th>type</th>
									<th style={{ textAlign: 'right' }}>gravity</th>
								</tr>
							</thead>
							<tbody>
								{sorted.map((relation) => (
									<tr key={relation.id}>
										<td>
											{nodeLabel(canvas.nodes[relation.from])} →{' '}
											{nodeLabel(canvas.nodes[relation.to])}
										</td>
										{/* An unlabelled relation shows a dash, not an empty cell: the
										    user connected these and didn't say why, and that is a
										    state worth being able to see. */}
										<td style={{ opacity: relation.type === undefined ? 0.4 : 1 }}>
											{relation.type ?? '—'}
										</td>
										<td style={{ textAlign: 'right' }}>{relation.gravity.toFixed(2)}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			)}
		</div>
	)
}

/**
 * Every directed pair, strongest first, so the pairs that actually carry a
 * signal sit above the long tail of zeroes rather than being buried by
 * whatever order the nodes happen to be in.
 */
function InfluenceSection({ canvas }: { canvas: CanvasDocument }) {
	const [isOpen, setIsOpen] = useState(true)

	// Read from the document rather than recomputed here: the influence table and
	// the JSON above it are then the same numbers by construction, so they can't
	// drift apart or round differently.
	const nodes = Object.values(canvas.nodes)
	const influences = canvas.spatialContext.influences
	const sorted = [...influences].sort((a, b) => b.influence - a.influence)
	const active = sorted.filter((row) => row.influence > 0).length

	// A radius is never applied implicitly, so a fresh canvas reads as all zeroes
	// and looks broken. Saying which of the two reasons it is — nobody has a
	// field, or everything is out of range — is the difference between a dead
	// table and an instruction.
	const withField = nodes.filter((node) => node.contextualField).length

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			<button onClick={() => setIsOpen(!isOpen)} style={buttonStyle}>
				{isOpen ? '▾' : '▸'} Spatial influence · {active} of {influences.length} pair
				{influences.length === 1 ? '' : 's'} in range
				{influences.length > 0 && withField === 0 ? ' · no radius set' : ''}
			</button>

			{isOpen && (
				<div style={{ ...preStyle, minHeight: 0, maxHeight: 200 }}>
					{influences.length === 0 ? (
						<span style={{ opacity: 0.6 }}>Needs at least two nodes.</span>
					) : withField === 0 ? (
						<span style={{ opacity: 0.6 }}>
							No node has a contextual field yet, so nothing can influence anything. Select a
							post-it and set a <strong>Contextual field radius</strong> in the style panel — a
							radius is never applied implicitly.
						</span>
					) : (
						<table style={{ width: '100%', borderCollapse: 'collapse' }}>
							<thead>
								<tr style={{ opacity: 0.6, textAlign: 'left' }}>
									<th>source → target</th>
									<th style={{ textAlign: 'right' }}>dist</th>
									<th style={{ textAlign: 'right' }}>influence</th>
								</tr>
							</thead>
							<tbody>
								{sorted.map((row) => (
									<InfluenceRow
										key={`${row.source}→${row.target}`}
										row={row}
										nodes={canvas.nodes}
									/>
								))}
							</tbody>
						</table>
					)}
				</div>
			)}
		</div>
	)
}

function InfluenceRow({ row, nodes }: { row: SpatialInfluence; nodes: CanvasDocument['nodes'] }) {
	return (
		<tr style={{ opacity: row.influence > 0 ? 1 : 0.4 }}>
			<td>
				{nodeLabel(nodes[row.source])} → {nodeLabel(nodes[row.target])}
			</td>
			{/* Already rounded by `buildSpatialContext` — shown verbatim so the
			    table and the JSON above are literally the same numbers. */}
			<td style={{ textAlign: 'right' }}>{row.distance}</td>
			<td style={{ textAlign: 'right' }}>{row.influence.toFixed(3)}</td>
		</tr>
	)
}

/**
 * The pairs the user connected, with both signals and their combination.
 *
 * Shows its working on every row — `influence`, `gravity`, then the result — for
 * the reason the layer exists: a single ranking number that hid its inputs would
 * be the conflation the model refuses, while one that prints them beside itself
 * can be checked. The strategy name sits in the header rather than on each row,
 * since one document is built with one strategy throughout.
 */
function EffectiveStrengthSection({ canvas }: { canvas: CanvasDocument }) {
	const [isOpen, setIsOpen] = useState(true)

	// Read from the document, like the two tables above it.
	const rows = canvas.spatialContext.effectiveStrengths
	const relations = Object.values(canvas.relations).length
	const strategy = rows[0]?.strategy ?? DEFAULT_STRATEGY.name

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			<button onClick={() => setIsOpen(!isOpen)} style={buttonStyle}>
				{isOpen ? '▾' : '▸'} Effective strength · {rows.length} connected pair
				{rows.length === 1 ? '' : 's'} · {strategy}
			</button>

			{isOpen && (
				<div style={{ ...preStyle, minHeight: 0, maxHeight: 200 }}>
					{rows.length === 0 ? (
						<span style={{ opacity: 0.6 }}>
							{relations === 0
								? 'Nothing connected yet — proximity alone produces no combined row.'
								: 'No relation connects two nodes on this canvas.'}
						</span>
					) : (
						<table style={{ width: '100%', borderCollapse: 'collapse' }}>
							<thead>
								<tr style={{ opacity: 0.6, textAlign: 'left' }}>
									<th>source → target</th>
									<th style={{ textAlign: 'right' }}>infl</th>
									<th style={{ textAlign: 'right' }}>grav</th>
									<th style={{ textAlign: 'right' }}>effective</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => (
									<tr key={`${row.source}→${row.target}`}>
										<td>
											{nodeLabel(canvas.nodes[row.source])} → {nodeLabel(canvas.nodes[row.target])}
										</td>
										{/* The two inputs dimmed, the result not: the row is about the
										    combination, and the inputs are here to make it checkable. */}
										<td style={{ textAlign: 'right', opacity: 0.6 }}>{row.influence.toFixed(3)}</td>
										<td style={{ textAlign: 'right', opacity: 0.6 }}>{row.gravity.toFixed(2)}</td>
										<td style={{ textAlign: 'right' }}>{row.effectiveStrength.toFixed(3)}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			)}
		</div>
	)
}

const LABEL_LENGTH = 20

/** A table of raw ids is unreadable, so nodes are named by their text. */
function nodeLabel(node: CanvasNode | undefined): string {
	if (!node) return '?'

	const text = node.content.text?.trim().replace(/\s+/g, ' ')
	if (!text) return node.id.slice(0, 8)

	return text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH)}…` : text
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
