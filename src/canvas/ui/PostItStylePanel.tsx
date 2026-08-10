/**
 * Colour and contextual-field controls for post-its.
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
		<div style={{ padding: '4px 8px' }}>
			<div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>{label}</div>
			<div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
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
							borderRadius: 4,
							cursor: 'pointer',
							backgroundColor: swatch,
							border:
								current === swatch
									? '2px solid var(--tl-color-selected, #2f80ed)'
									: '1px solid rgba(0, 0, 0, 0.2)',
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
			<PostItColorSection />
			<DefaultStylePanelContent />
		</DefaultStylePanel>
	)
}
