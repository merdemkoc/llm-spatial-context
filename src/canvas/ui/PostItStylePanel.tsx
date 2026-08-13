/**
 * Colour and contextual-field controls for post-its, and gravity for relations.
 *
 * These exist so that "a visual interaction updates `Node.visual`" is something
 * the app can actually do, not just something the model supports. tldraw's own
 * colour picker is driven by `DefaultColorStyle`, which our shapes deliberately
 * don't use.
 *
 * The default panel content is rendered alongside rather than replaced:
 * `DefaultStylePanel` swaps its children in for its default content entirely,
 * and opacity — which is part of `VisualProperties` — lives in there.
 */
import {
	DefaultStylePanel,
	DefaultStylePanelContent,
	useEditor,
	useValue,
	type StyleProp,
	type TLUiStylePanelProps,
} from 'tldraw'
import {
	POST_IT_FILL_SWATCHES,
	POST_IT_INK_SWATCHES,
	PostItFillStyle,
	PostItStrokeStyle,
	PostItTextColorStyle,
} from '@/canvas/shapes/postItStyles'
import { ContextualFieldControl } from '@/canvas/ui/ContextualFieldControl'
import { RelationGravityControl } from '@/canvas/ui/RelationGravityControl'
import { caption } from '@/canvas/ui/theme'

interface SwatchRowProps {
	label: string
	style: StyleProp<string>
	swatches: string[]
}

function SwatchRow({ label, style, swatches }: SwatchRowProps) {
	const editor = useEditor()
	const current = useValue('shared style', () => editor.getSharedStyles().getAsKnownValue(style), [
		editor,
		style,
	])

	return (
		<div style={{ padding: 'var(--tl-space-2) var(--tl-space-3)' }}>
			<div style={{ ...caption, marginBottom: 'var(--tl-space-2)' }}>{label}</div>
			<div style={{ display: 'flex', gap: 'var(--tl-space-2)', flexWrap: 'wrap' }}>
				{swatches.map((swatch) => (
					<button
						key={swatch}
						title={swatch}
						aria-label={`${label} ${swatch}`}
						aria-pressed={current === swatch}
						onPointerDown={(event) => event.stopPropagation()}
						onClick={() => {
							editor.markHistoryStoppingPoint(`set ${label}`)
							editor.setStyleForSelectedShapes(style, swatch)
						}}
						style={{
							width: 20,
							height: 20,
							borderRadius: 'var(--tl-radius-1)',
							cursor: 'pointer',
							backgroundColor: swatch,
							// The selected ring is a shadow rather than a thicker border: swapping 1px
							// for 2px shrinks the box a pixel on each axis, so every swatch in the row
							// twitched as the selection moved along it.
							border: '1px solid var(--tl-color-divider)',
							boxShadow: current === swatch ? '0 0 0 2px var(--tl-color-selected)' : undefined,
						}}
					/>
				))}
			</div>
		</div>
	)
}

/**
 * Only shown when the selection actually has our styles — otherwise the panel
 * would advertise post-it colours while a draw shape is selected.
 */
function PostItColorSection() {
	const editor = useEditor()
	const hasPostItStyles = useValue(
		'has post-it styles',
		() => editor.getSharedStyles().get(PostItFillStyle) !== undefined,
		[editor]
	)

	if (!hasPostItStyles) return null

	return (
		<div className="tlui-style-panel__section">
			<SwatchRow label="Fill" style={PostItFillStyle} swatches={POST_IT_FILL_SWATCHES} />
			<SwatchRow label="Stroke" style={PostItStrokeStyle} swatches={POST_IT_INK_SWATCHES} />
			<SwatchRow label="Text" style={PostItTextColorStyle} swatches={POST_IT_INK_SWATCHES} />
		</div>
	)
}

export function PostItStylePanel(props: TLUiStylePanelProps) {
	return (
		<DefaultStylePanel {...props}>
			<ContextualFieldControl />
			{/* Each returns null unless the selection is its own kind of thing, so only
			    one of the two is ever on screen for a normal selection. */}
			<RelationGravityControl />
			<PostItColorSection />
			<DefaultStylePanelContent />
		</DefaultStylePanel>
	)
}
