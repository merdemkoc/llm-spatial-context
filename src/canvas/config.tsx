/**
 * Everything the <Tldraw /> component needs to know about our customisations,
 * in one place. Register new shapes, tools and UI overrides here.
 *
 * These values are deliberately declared at module scope. tldraw compares them
 * by identity, so rebuilding them on every render would remount the editor.
 */
import {
	DefaultToolbar,
	DefaultToolbarContent,
	TldrawUiMenuItem,
	useIsToolSelected,
	useTools,
	type TLComponents,
	type TLUiOverrides,
} from 'tldraw'
import { PostItShapeUtil } from '@/canvas/shapes/PostItShapeUtil'
import { PostItTool } from '@/canvas/shapes/PostItTool'
import { RelationTool, RELATION_TOOL_ID } from '@/canvas/shapes/RelationTool'
import { POST_IT_SHAPE_TYPE } from '@/canvas/shapes/postItShape'
import { PostItStylePanel } from '@/canvas/ui/PostItStylePanel'
import { InspectorPanel } from '@/canvas/ui/InspectorPanel'
import { ContextualFieldOverlay } from '@/canvas/ui/ContextualFieldOverlay'
import { ContextualFieldToggle } from '@/canvas/ui/ContextualFieldToggle'
import { CompanionControls } from '@/canvas/ui/CompanionControls'
import { AgentThinkingIndicator } from '@/canvas/ui/AgentThinkingIndicator'
import { CompanionTranscriptPanel } from '@/canvas/ui/CompanionTranscriptPanel'

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
			 * Draws the same shape as the arrow tool beside it. The difference is the
			 * claim: an arrow drawn here lands in `relations`, one drawn with the arrow
			 * tool stays decoration.
			 */
			[RELATION_TOOL_ID]: {
				id: RELATION_TOOL_ID,
				label: 'Relation',
				// A curved arrow rather than `tool-arrow`: this sits two places from the
				// real arrow tool on the toolbar, and with the same icon the two are
				// indistinguishable — which matters when only one of them means anything.
				icon: 'arrow-arc',
				kbd: 'r',
				onSelect: () => editor.setCurrentTool(RELATION_TOOL_ID),
			},
		}
	},
}

export const components: TLComponents = {
	/**
	 * Registering a tool doesn't put it on the toolbar — the toolbar renders a
	 * fixed list. Override it to add our own entry ahead of the defaults.
	 */
	Toolbar: (props) => {
		const tools = useTools()
		const isPostItSelected = useIsToolSelected(tools[POST_IT_SHAPE_TYPE])
		const isRelationSelected = useIsToolSelected(tools[RELATION_TOOL_ID])

		return (
			<DefaultToolbar {...props}>
				<TldrawUiMenuItem {...tools[POST_IT_SHAPE_TYPE]} isSelected={isPostItSelected} />
				<TldrawUiMenuItem {...tools[RELATION_TOOL_ID]} isSelected={isRelationSelected} />
				<DefaultToolbarContent />
			</DefaultToolbar>
		)
	},

	StylePanel: PostItStylePanel,

	/**
	 * Stacked rather than merged into the Inspector's own header: that component
	 * renders two different trees depending on whether it's open, and the field
	 * switch has to be visible either way.
	 */
	SharePanel: () => (
		<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
			<ContextualFieldToggle />
			<CompanionControls />
			<AgentThinkingIndicator />
			<div
				onPointerDown={(event) => event.stopPropagation()}
				style={{ width: 280, padding: 8, pointerEvents: 'all' }}
			>
				<CompanionTranscriptPanel />
			</div>
			<InspectorPanel />
		</div>
	),

	/**
	 * Inside the camera-transformed layer and behind the shapes, so field circles
	 * pan and zoom with the canvas and never cover a note's text. Also outside the
	 * export path, which is what keeps them off the grounded screenshot.
	 */
	OnTheCanvas: ContextualFieldOverlay,

	/**
	 * One Canvas is one page. Hiding the page menu keeps that true rather than
	 * leaving the canonical model quietly describing only part of the document.
	 */
	PageMenu: null,
}
