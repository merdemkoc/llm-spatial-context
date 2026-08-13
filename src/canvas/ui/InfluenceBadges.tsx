/**
 * What the selected Node's field actually does, written on the Nodes it does it to.
 *
 * The field overlay shows *reach*; this shows the **consequence** of that reach.
 * The number already exists in `spatialContext` and is already tabulated in the
 * Inspector — what was missing was having it where the note is, instead of in a
 * table of `N² − N` rows keyed by truncated text.
 *
 * Both directions are shown, because influence is asymmetric: it depends on the
 * *source's* radius, so `a → b` and `b → a` are different numbers for the same
 * pair at the same distance. Collapsing them to one figure would hide the single
 * most surprising property of the model.
 *
 * This is not a relation and does not claim to be one. It reports a derived
 * spatial quantity, exactly as `spatialContext` does; `relations` stays what the
 * user said. It also never reaches a grounded screenshot — it renders inside
 * `OnTheCanvas`, which the export path doesn't draw.
 */
import type { CanvasDocument, CanvasNode, NodeId, SpatialInfluence } from '@/domain'
import { nodeCorners } from '@/canvas/grounding/projection'
import { MONO_FAMILY, fieldTint } from '@/canvas/ui/theme'

/**
 * Indigo, matching the field circles: the reach and its consequence are one
 * overlay saying one thing, and should read as one thing. Near-opaque, because
 * these sit over notes whose fill the digits have to stay legible against — so
 * the tint takes an alpha instead of the shared panel tokens.
 */
const BADGE_BACKGROUND = fieldTint(0.92)
const BADGE_TEXT = '#FFFFFF'

const FONT_SIZE = 11
/** Screen pixels between the badge's bottom edge and the node's top edge. */
const GAP = 6

const ARROW_HELP =
	'→ how much the selected node reaches this one · ← how much this one reaches the selected node'

export interface InfluenceBadgesProps {
	canvas: CanvasDocument
	/** The single selected post-it. `→` and `←` are relative to it. */
	selectedId: NodeId
	zoom: number
}

export function InfluenceBadges({ canvas, selectedId, zoom }: InfluenceBadgesProps) {
	const influences = canvas.spatialContext.influences

	return (
		<>
			{Object.values(canvas.nodes)
				.filter((node) => node.id !== selectedId)
				.map((node) => (
					<InfluenceBadge
						key={node.id}
						node={node}
						outgoing={find(influences, selectedId, node.id)}
						incoming={find(influences, node.id, selectedId)}
						zoom={zoom}
					/>
				))}
		</>
	)
}

function find(
	influences: SpatialInfluence[],
	source: NodeId,
	target: NodeId
): SpatialInfluence | undefined {
	return influences.find((influence) => influence.source === source && influence.target === target)
}

interface InfluenceBadgeProps {
	node: CanvasNode
	outgoing: SpatialInfluence | undefined
	incoming: SpatialInfluence | undefined
	zoom: number
}

function InfluenceBadge({ node, outgoing, incoming, zoom }: InfluenceBadgeProps) {
	// Out of range both ways is not a relationship worth labelling. A badge on
	// every node on the canvas reading 0.000 would bury the ones that carry a
	// signal — the same reason the Inspector sorts by influence.
	if (!outgoing?.influence && !incoming?.influence) return null

	// Above the node's *rotated* extent, so the badge clears the note whatever its
	// rotation. `nodeCorners` already owns that geometry.
	const corners = nodeCorners(node)
	const anchorX = (Math.min(...corners.map((c) => c.x)) + Math.max(...corners.map((c) => c.x))) / 2
	const anchorY = Math.min(...corners.map((c) => c.y))

	return (
		<div
			data-influence-badge={node.id}
			title={ARROW_HELP}
			style={{
				position: 'absolute',
				left: anchorX,
				top: anchorY,
				// Counter-scaled, unlike the field circles. A circle is a world-space
				// object and should grow with the canvas; text that grows becomes a
				// billboard, so this stays one size on screen at every zoom.
				transform: `translate(-50%, -100%) translateY(${-GAP}px) scale(${1 / zoom})`,
				transformOrigin: 'bottom center',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'flex-start',
				padding: '3px 6px',
				borderRadius: 'var(--tl-radius-1)',
				background: BADGE_BACKGROUND,
				color: BADGE_TEXT,
				font: `${FONT_SIZE}px/1.4 ${MONO_FAMILY}`,
				whiteSpace: 'nowrap',
				// Never what a click lands on: the badge floats over the canvas near a
				// note the user is probably trying to hit.
				pointerEvents: 'none',
			}}
		>
			<span>→ {format(outgoing)}</span>
			<span>← {format(incoming)}</span>
			{/* Centre-to-centre distance is symmetric, so it belongs to the pair
			    rather than to either direction, and is stated once. */}
			<span style={{ opacity: 0.75 }}>{distanceOf(outgoing, incoming)} u</span>
		</div>
	)
}

/**
 * Three decimals, matching the Inspector's table and the canonical JSON.
 * `buildSpatialContext` already rounded these — they are shown verbatim so the
 * note, the table and the document are literally the same numbers.
 */
function format(influence: SpatialInfluence | undefined): string {
	return (influence?.influence ?? 0).toFixed(3)
}

function distanceOf(
	outgoing: SpatialInfluence | undefined,
	incoming: SpatialInfluence | undefined
): number {
	return outgoing?.distance ?? incoming?.distance ?? 0
}
