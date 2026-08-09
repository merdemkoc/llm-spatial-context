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
import { NoteCardShapeUtil, NOTE_CARD_TYPE } from '@/shapes/NoteCardShapeUtil'
import { NoteCardTool } from '@/tools/NoteCardTool'

export const customShapeUtils = [NoteCardShapeUtil]

export const customTools = [NoteCardTool]

/** Registers the tool with the UI, giving it a label and a keyboard shortcut. */
export const uiOverrides: TLUiOverrides = {
	tools(editor, tools) {
		return {
			...tools,
			[NOTE_CARD_TYPE]: {
				id: NOTE_CARD_TYPE,
				label: 'Note card',
				icon: 'tool-note',
				kbd: 'c',
				onSelect: () => editor.setCurrentTool(NOTE_CARD_TYPE),
			},
		}
	},
}

/**
 * Registering a tool doesn't put it on the toolbar — the toolbar renders a
 * fixed list. Override it to add our own entry ahead of the defaults.
 */
export const components: TLComponents = {
	Toolbar: (props) => {
		const tools = useTools()
		const isNoteCardSelected = useIsToolSelected(tools[NOTE_CARD_TYPE])

		return (
			<DefaultToolbar {...props}>
				<TldrawUiMenuItem {...tools[NOTE_CARD_TYPE]} isSelected={isNoteCardSelected} />
				<DefaultToolbarContent />
			</DefaultToolbar>
		)
	},
}
