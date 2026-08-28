/**
 * Everything the <Tldraw /> component needs to know about our customisations,
 * in one place. Register new shapes, tools and UI overrides here.
 *
 * These values are deliberately declared at module scope. tldraw compares them
 * by identity, so rebuilding them on every render would remount the editor.
 */
import {
	CenteredTopPanelContainer,
	DefaultToolbar,
	ToolbarItem,
	type TLComponents,
	type TLUiOverrides,
} from 'tldraw'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { PostItTool } from '@/canvas/shapes/PostItTool'
import { RelationTool, RELATION_TOOL_ID } from '@/canvas/shapes/RelationTool'
import { POST_IT_SHAPE_TYPE } from '@/canvas/shapes/postItShape'
import { PostItStylePanel } from '@/canvas/ui/PostItStylePanel'
import { InspectorDock } from '@/canvas/ui/InspectorDock'
import { CompanionBar } from '@/canvas/ui/CompanionBar'
import { CanvasOverlays } from '@/canvas/ui/CanvasOverlays'
import { CanvasControls } from '@/canvas/ui/CanvasControls'
import { CanvasAiActions } from '@/canvas/ui/CanvasAiActions'

export const customShapeUtils = [PostItShapeUtil]

export const customTools = [PostItTool, RelationTool]

/** Registers the tools with the UI, giving them labels and keyboard shortcuts. */
export const uiOverrides: TLUiOverrides = {
	tools(editor, tools) {
		return {
			...tools,
			[POST_IT_SHAPE_TYPE]: {
				id: POST_IT_SHAPE_TYPE,
				label: 'Post-it',
				icon: 'tool-note',
				kbd: 'p',
				onSelect: () => editor.setCurrentTool(POST_IT_SHAPE_TYPE),
			},
			/**
			 * Draws the same shape as the plain arrow tool. The difference is the claim:
			 * an arrow drawn here lands in `relations`, one drawn with the arrow tool
			 * stays decoration.
			 */
			[RELATION_TOOL_ID]: {
				id: RELATION_TOOL_ID,
				label: 'Relation',
				// A curved arrow rather than `tool-arrow`. The plain arrow tool is off the
				// toolbar but still live on `a`, and the arrows it draws mean nothing — so
				// the two still need to look different wherever they appear side by side,
				// like the keyboard-shortcuts dialog.
				icon: 'arrow-arc',
				kbd: 'r',
				onSelect: () => editor.setCurrentTool(RELATION_TOOL_ID),
			},
		}
	},
}

export const components: TLComponents = {
	/**
	 * The toolbar renders a fixed list rather than everything registered, so this
	 * override is what puts our two tools on it — and, by naming the list itself
	 * instead of `<DefaultToolbarContent />`, what keeps tldraw's own entries off.
	 *
	 * Only four tools describe anything the canonical model knows about: a post-it
	 * is a Node, a relation is a Relation, and pointer and hand are how you read
	 * the canvas. A rectangle or a laser pointer would be a mark the model cannot
	 * account for, so offering one is an invitation to work the prototype can't
	 * hear. The rest stay registered and stay on their keyboard shortcuts — this
	 * hides buttons, it doesn't remove tools.
	 */
	Toolbar: (props) => (
		<DefaultToolbar {...props}>
			<ToolbarItem tool="select" />
			<ToolbarItem tool="hand" />
			<ToolbarItem tool={POST_IT_SHAPE_TYPE} />
			<ToolbarItem tool={RELATION_TOOL_ID} />
			{/* The companion's on-demand actions, set off from the four tools by a divider.
			    These are actions, not tools, so they are plain buttons rather than ToolbarItems. */}
			<CanvasAiActions />
			{/* tldraw's own tools, in its default order. Uncomment a line to put one back.
			<ToolbarItem tool="draw" />
			<ToolbarItem tool="eraser" />
			<ToolbarItem tool="arrow" />
			<ToolbarItem tool="text" />
			<ToolbarItem tool="note" />
			<ToolbarItem tool="rectangle" />
			<ToolbarItem tool="ellipse" />
			<ToolbarItem tool="triangle" />
			<ToolbarItem tool="diamond" />
			<ToolbarItem tool="hexagon" />
			<ToolbarItem tool="oval" />
			<ToolbarItem tool="rhombus" />
			<ToolbarItem tool="star" />
			<ToolbarItem tool="cloud" />
			<ToolbarItem tool="heart" />
			<ToolbarItem tool="x-box" />
			<ToolbarItem tool="check-box" />
			<ToolbarItem tool="arrow-left" />
			<ToolbarItem tool="arrow-up" />
			<ToolbarItem tool="arrow-down" />
			<ToolbarItem tool="arrow-right" />
			<ToolbarItem tool="line" />
			<ToolbarItem tool="highlight" />
			<ToolbarItem tool="laser" />
			<ToolbarItem tool="frame" />
			The media picker is the exception: it takes tldraw's own `<AssetToolbarItem />`,
			since `asset` opens a file dialog rather than becoming the current tool. */}
		</DefaultToolbar>
	),

	StylePanel: PostItStylePanel,

	/**
	 * The top-right corner. tldraw renders this zone above the style panel in one
	 * column, so what lives here decides how far down the screen the style panel
	 * starts: a rail of two buttons rather than a stack of five cards.
	 */
	SharePanel: InspectorDock,

	/**
	 * The top-centre zone, which tldraw leaves empty and we give to the companion —
	 * the one part of this UI that speaks without being asked.
	 *
	 * `CenteredTopPanelContainer` is tldraw's own: it measures the left and right zones
	 * and squeezes itself rather than sliding under them, so the bar never collides with
	 * the menu or with the Inspector rail.
	 */
	TopPanel: () => (
		<CenteredTopPanelContainer maxWidth={460}>
			<CompanionBar />
		</CenteredTopPanelContainer>
	),

	/**
	 * Inside the camera-transformed layer and behind the shapes, so the field circles and
	 * the grouping ghost pan and zoom with the canvas and never cover a note's text. Also
	 * outside the export path, which is what keeps them off the grounded screenshot. Both
	 * overlays share this single slot through `CanvasOverlays`.
	 */
	OnTheCanvas: CanvasOverlays,

	/**
	 * Screen space, above the shapes: the pointer-enabled controls for a pending proposal —
	 * a grouping's accept/dismiss, or a reflection's idea list. They must take pointer events,
	 * which the `OnTheCanvas` layer deliberately does not, so they live here rather than with
	 * the ghosts they belong to. Composed through `CanvasControls`.
	 */
	InFrontOfTheCanvas: CanvasControls,

	/**
	 * One Canvas is one page. Hiding the page menu keeps that true rather than
	 * leaving the canonical model quietly describing only part of the document.
	 */
	PageMenu: null,
}
