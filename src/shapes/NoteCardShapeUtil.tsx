/**
 * Example custom shape: a resizable note card.
 *
 * This is a reference implementation of the tldraw v5 shape API — copy it as a
 * starting point for your own shapes. Nothing else in the app depends on it, so
 * it is safe to delete once you have shapes of your own (also remove it from
 * `src/canvas/config.tsx`).
 */
import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	T,
	resizeBox,
	type RecordProps,
	type TLResizeInfo,
	type TLShape,
} from 'tldraw'

export const NOTE_CARD_TYPE = 'note-card'

export const NOTE_CARD_DEFAULT_WIDTH = 220
export const NOTE_CARD_DEFAULT_HEIGHT = 140

/**
 * Custom shapes register their props through module augmentation. This is what
 * makes `TLShape<'note-card'>` below resolve to a fully typed shape.
 */
declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[NOTE_CARD_TYPE]: {
			w: number
			h: number
			text: string
		}
	}
}

export type NoteCardShape = TLShape<typeof NOTE_CARD_TYPE>

export class NoteCardShapeUtil extends ShapeUtil<NoteCardShape> {
	static override type = NOTE_CARD_TYPE

	/**
	 * Validators for the shape's props. Optional, but worth keeping: they stop
	 * malformed data from entering the persisted document.
	 */
	static override props: RecordProps<NoteCardShape> = {
		w: T.number,
		h: T.number,
		text: T.string,
	}

	getDefaultProps(): NoteCardShape['props'] {
		return {
			w: NOTE_CARD_DEFAULT_WIDTH,
			h: NOTE_CARD_DEFAULT_HEIGHT,
			text: 'Note',
		}
	}

	getGeometry(shape: NoteCardShape) {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		})
	}

	override canResize() {
		return true
	}

	override onResize(shape: NoteCardShape, info: TLResizeInfo<NoteCardShape>) {
		return resizeBox(shape, info)
	}

	component(shape: NoteCardShape) {
		return (
			<HTMLContainer
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: shape.props.w,
					height: shape.props.h,
					padding: 12,
					border: '1px solid var(--tl-color-muted-1, #e8e8e8)',
					borderRadius: 8,
					backgroundColor: 'var(--tl-color-panel, #fff)',
					boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
					pointerEvents: 'all',
					textAlign: 'center',
					overflow: 'hidden',
				}}
			>
				{shape.props.text}
			</HTMLContainer>
		)
	}

	/**
	 * In tldraw v5 the selection indicator is a `Path2D` composited onto the
	 * overlay canvas — it is no longer a JSX element as it was in v2–v4.
	 */
	getIndicatorPath(shape: NoteCardShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}
}
