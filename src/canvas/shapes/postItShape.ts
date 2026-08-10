/**
 * The tldraw projection of a `post_it` Node: type name, shape type, guard.
 *
 * The shape type string is deliberately different from the canonical NodeType
 * (`post-it` here, `post_it` in the domain). If they were the same string the
 * two layers would fuse by accident and nobody would notice; the adapter maps
 * between them explicitly.
 *
 * This module imports tldraw for *types only*, so that importing it — and
 * therefore the adapter — pulls no tldraw runtime code. That is what lets the
 * round-trip tests run in plain Node without jsdom. Style props, which are real
 * values, live in `postItStyles.ts`.
 */
import type { TLRichText, TLShape } from 'tldraw'

export const POST_IT_SHAPE_TYPE = 'post-it'

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[POST_IT_SHAPE_TYPE]: {
			w: number
			h: number
			richText: TLRichText
			fill: string
			stroke: string
			textColor: string
		}
	}
}

export type PostItShape = TLShape<typeof POST_IT_SHAPE_TYPE>

export function isPostItShape(shape: TLShape): shape is PostItShape {
	return shape.type === POST_IT_SHAPE_TYPE
}
