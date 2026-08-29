/**
 * How far the board has drifted from the reading the companion currently holds.
 *
 * Deciding whether to spend money must not cost money. `isTrivialEpisode` is the precedent —
 * a pure gate above the model call, because a cap enforced after the request is a display cap
 * and an uncapped bill. This is that shape one level up: it decides when the standing
 * understanding has gone stale enough to be worth re-deriving.
 *
 * The weights encode a claim about where meaning lives. A note created or deleted is content
 * gained or lost; an arrow drawn or removed is a claim made or retracted; a cluster forming is
 * a theme forming. Dragging is none of those — and dragging is the overwhelming majority of
 * events, so it scores nothing. Without that the companion would re-read the whole board every
 * time the user tidied the layout.
 *
 * Pure, no tldraw.
 */
import type { SpatialEvent } from '@/domain/events'

/**
 * The drift at which the standing reading is stale enough to re-derive.
 *
 * Six is two new notes, or a note plus an arrow, or three arrows. Low enough that the reading
 * keeps up with real work; high enough that one stray note does not buy a model call.
 */
export const DRIFT_THRESHOLD = 6

/** What one event does to the reading's freshness. */
export function driftWeight(event: SpatialEvent): number {
	switch (event.type) {
		case 'node_created':
		case 'node_deleted':
			return 3
		case 'relation_created':
		case 'relation_deleted':
		case 'relation_rebound':
			return 2
		case 'proximity_changed':
			// Upward only. A cluster forming is a theme forming; one loosening is the
			// observer's business, not a reason to re-read the whole board.
			return event.level === 'strong' ? 1 : 0
		case 'contextual_field_changed':
			return 1
		default:
			return 0
	}
}

/** The drift a whole episode's worth of events adds. */
export function driftOf(events: SpatialEvent[]): number {
	return events.reduce((total, event) => total + driftWeight(event), 0)
}
