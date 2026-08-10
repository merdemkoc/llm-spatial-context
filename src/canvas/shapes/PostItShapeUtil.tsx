/**
 * Renders and drives interaction for the post-it shape.
 *
 * This class holds no canonical truth. Everything it stores is either read back
 * out by the adapter (`src/canvas/adapter/adapter.ts`) or is presentation detail
 * that the canonical model deliberately doesn't model.
 */
import {
	HTMLContainer,
	Rectangle2d,
	RichTextLabel,
	ShapeUtil,
	T,
	resizeBox,
	toRichText,
	type RecordProps,
	type TLResizeInfo,
} from 'tldraw'
import { POST_IT_SHAPE_TYPE, type PostItShape } from '@/canvas/shapes/postItShape'
import {
	PostItFillStyle,
	PostItStrokeStyle,
	PostItTextColorStyle,
} from '@/canvas/shapes/postItStyles'
import { POST_IT_DEFAULT_HEIGHT, POST_IT_DEFAULT_VISUAL, POST_IT_DEFAULT_WIDTH } from '@/domain'

const FONT_FAMILY = 'var(--tl-font-sans, sans-serif)'
const FONT_SIZE = 16
const LINE_HEIGHT = 1.35
const PADDING = 12

export class PostItShapeUtil extends ShapeUtil<PostItShape> {
	static override type = POST_IT_SHAPE_TYPE

	/**
	 * Validators keep malformed data out of the persisted document. The three
	 * `StyleProp` instances are recognised automatically, which is what puts
	 * these colours in front of the style panel.
	 */
	static override props: RecordProps<PostItShape> = {
		w: T.number,
		h: T.number,
		richText: T.any,
		fill: PostItFillStyle,
		stroke: PostItStrokeStyle,
		textColor: PostItTextColorStyle,
	}

	getDefaultProps(): PostItShape['props'] {
		return {
			w: POST_IT_DEFAULT_WIDTH,
			h: POST_IT_DEFAULT_HEIGHT,
			richText: toRichText(''),
			fill: POST_IT_DEFAULT_VISUAL.fill,
			stroke: POST_IT_DEFAULT_VISUAL.stroke,
			textColor: POST_IT_DEFAULT_VISUAL.textColor,
		}
	}

	getGeometry(shape: PostItShape) {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		})
	}

	override canResize() {
		return true
	}

	/** Double-click to edit text. Without this the rich text label stays inert. */
	override canEdit() {
		return true
	}

	override onResize(shape: PostItShape, info: TLResizeInfo<PostItShape>) {
		return resizeBox(shape, info)
	}

	component(shape: PostItShape) {
		const { id, type, props } = shape
		const isSelected = id === this.editor.getOnlySelectedShapeId()

		return (
			<HTMLContainer
				style={{
					width: props.w,
					height: props.h,
					backgroundColor: props.fill,
					border: `1px solid ${props.stroke}`,
					borderRadius: 2,
					boxShadow: '0 1px 4px rgba(0, 0, 0, 0.15)',
					pointerEvents: 'all',
					overflow: 'hidden',
				}}
			>
				<RichTextLabel
					shapeId={id}
					type={type}
					richText={props.richText}
					labelColor={props.textColor}
					fontFamily={FONT_FAMILY}
					fontSize={FONT_SIZE}
					lineHeight={LINE_HEIGHT}
					textAlign="start"
					verticalAlign="start"
					padding={PADDING}
					isSelected={isSelected}
					wrap
				/>
			</HTMLContainer>
		)
	}

	/**
	 * v5: the selection indicator is a `Path2D` composited onto the overlay
	 * canvas, not the JSX element it was in v2–v4.
	 */
	getIndicatorPath(shape: PostItShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}
}
