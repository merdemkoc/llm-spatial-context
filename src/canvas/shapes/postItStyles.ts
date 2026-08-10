/**
 * Colours are raw hex, not tldraw's `DefaultColorStyle`.
 *
 * `DefaultColorStyle` stores theme *names* that resolve to different hex values
 * in light and dark mode, which would make `visual.fill` theme-dependent and the
 * round trip lossy. Declaring them as `StyleProp`s rather than plain `T.string`
 * still buys the sticky last-used-value behaviour and the shared-styles tracking
 * the style panel needs.
 */
import { StyleProp, T } from 'tldraw'
import { POST_IT_DEFAULT_VISUAL } from '@/domain'

export const PostItFillStyle = StyleProp.define('canvas:fill', {
	defaultValue: POST_IT_DEFAULT_VISUAL.fill,
	type: T.string,
})

export const PostItStrokeStyle = StyleProp.define('canvas:stroke', {
	defaultValue: POST_IT_DEFAULT_VISUAL.stroke,
	type: T.string,
})

export const PostItTextColorStyle = StyleProp.define('canvas:textColor', {
	defaultValue: POST_IT_DEFAULT_VISUAL.textColor,
	type: T.string,
})

/** Fill swatches, presented in the style panel in this order. */
export const POST_IT_FILL_SWATCHES = [
	'#FFF59D',
	'#FFCC80',
	'#EF9A9A',
	'#CE93D8',
	'#90CAF9',
	'#A5D6A7',
	'#E0E0E0',
	'#FFFFFF',
]

/** Swatches for stroke and text, which want contrast rather than pastels. */
export const POST_IT_INK_SWATCHES = [
	'#000000',
	'#5C5C5C',
	'#B0B0B0',
	'#FFFFFF',
	'#C62828',
	'#1565C0',
	'#2E7D32',
	'#6A1B9A',
]
