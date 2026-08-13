/**
 * A live view of the spatial event stream.
 *
 * The other Inspector sections show the canvas *now*; this shows what just *changed* —
 * the structured events a move, a radius edit or an arrow produced, newest first. It is
 * the observable form of the stream the spec calls for: the same records a future AI
 * observer would consume, made visible so the "user action → spatial change → event"
 * chain can be watched happening.
 *
 * A view over the stream, holding no truth of its own. The stream is a prop, defaulting
 * to the app-wide singleton, so a test can drive a fresh one.
 */
import { useEffect, useState } from 'react'
import { spatialEventStream, type SpatialEvent, type SpatialEventStream } from '@/domain'
import { caption, panelButton, readoutBox } from '@/canvas/ui/theme'

/** How many events the panel shows. The stream retains more; this is just the window. */
const VISIBLE = 50

export function EventLogPanel({ stream = spatialEventStream }: { stream?: SpatialEventStream }) {
	const [isOpen, setIsOpen] = useState(true)
	// Newest first, seeded from whatever the stream already holds so a panel opened
	// mid-session isn't blank. `getRecent` is oldest-first, so reverse it once here.
	const [events, setEvents] = useState<SpatialEvent[]>(() => [...stream.getRecent()].reverse())

	// Subscribe for updates and set state from the callback — the sanctioned effect
	// shape. Pre-mount history is already seeded by the `useState` initializer above, so
	// the effect body itself sets no state.
	useEffect(() => {
		return stream.subscribe((event) => {
			setEvents((previous) => [event, ...previous].slice(0, VISIBLE))
		})
	}, [stream])

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tl-space-2)' }}>
			<div style={{ display: 'flex', gap: 'var(--tl-space-2)', alignItems: 'center' }}>
				<button
					onClick={() => setIsOpen(!isOpen)}
					style={{ ...panelButton, flex: 1, textAlign: 'left' }}
				>
					{isOpen ? '▾' : '▸'} Event stream · {events.length} event{events.length === 1 ? '' : 's'}
				</button>
				<button
					onClick={() => {
						stream.clear()
						setEvents([])
					}}
					style={panelButton}
				>
					Clear
				</button>
			</div>

			{isOpen && (
				// The log scrolls, so its wheel events must not reach the canvas — otherwise
				// reading back what happened zooms the drawing.
				<div onWheel={(event) => event.stopPropagation()} style={{ ...readoutBox, maxHeight: 200 }}>
					{events.length === 0 ? (
						<span style={caption}>
							Nothing yet. Move a post-it across another’s contextual field, or draw a{' '}
							<strong>Relation</strong>, and the change shows up here as an event.
						</span>
					) : (
						<table style={{ width: '100%', borderCollapse: 'collapse' }}>
							<tbody>
								{events.map((event, index) => (
									<tr key={index} style={{ verticalAlign: 'top' }}>
										<td style={{ whiteSpace: 'nowrap', paddingRight: 'var(--tl-space-3)' }}>
											{event.type}
										</td>
										<td style={{ color: 'var(--tl-color-text-3)' }}>{describeEvent(event)}</td>
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
 * The right-hand column: who the event was about and, for a transition, the numbers on
 * either side of it. The type itself is already in the left column, so this never
 * repeats it — it only carries the detail that makes one `influence_changed` different
 * from another.
 */
function describeEvent(event: SpatialEvent): string {
	switch (event.type) {
		case 'node_created':
		case 'node_deleted':
			return event.nodeId
		case 'node_moved':
			return `${event.nodeId} · (${event.previous.x}, ${event.previous.y}) → (${event.current.x}, ${event.current.y})`
		case 'contextual_field_changed':
			return `${event.nodeId} · ${event.previous ?? '—'} → ${event.current ?? '—'}`
		case 'relation_created':
		case 'relation_deleted':
			return `${event.source}→${event.target} · gravity ${event.gravity.toFixed(2)}`
		case 'relation_rebound':
			return `${event.previous.source}→${event.previous.target} ⇒ ${event.current.source}→${event.current.target}`
		case 'relation_gravity_changed':
			return `${event.relationId.slice(0, 8)} · ${event.previous.toFixed(2)} → ${event.current.toFixed(2)}`
		case 'field_entered':
		case 'field_exited':
		case 'influence_changed':
			return `${event.source}→${event.target} · infl ${event.previous.influence.toFixed(2)} → ${event.current.influence.toFixed(2)}`
		case 'proximity_changed':
			return `${event.source}→${event.target} · ${event.level} · infl ${event.previous.influence.toFixed(2)} → ${event.current.influence.toFixed(2)}`
	}
}
