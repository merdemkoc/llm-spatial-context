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
import { POST_IT_SHAPE_TYPE } from '@/canvas/shapes/postItShape'
import { PostItStylePanel } from '@/canvas/ui/PostItStylePanel'
import { InspectorPanel } from '@/canvas/ui/InspectorPanel'

export const customShapeUtils = [PostItShapeUtil]

export const customTools = [PostItTool]

/** Registers the tool with the UI, giving it a label and a keyboard shortcut. */
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

		return (
			<DefaultToolbar {...props}>
				<TldrawUiMenuItem {...tools[POST_IT_SHAPE_TYPE]} isSelected={isPostItSelected} />
				<DefaultToolbarContent />
			</DefaultToolbar>
		)
	},

	StylePanel: PostItStylePanel,

	SharePanel: InspectorPanel,

	/**
	 * One Canvas is one page. Hiding the page menu keeps that true rather than
	 * leaving the canonical model quietly describing only part of the document.
	 */
	PageMenu: null,
}
