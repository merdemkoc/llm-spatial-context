/**
 * Plain text ⇄ rich text, kept pure.
 *
 * tldraw's own helpers can't be used here:
 *   - `renderPlaintextFromRichText(editor, richText)` takes a live `Editor`,
 *     which would drag a running editor into every round-trip test. (There is a
 *     pure variant for HTML — `renderHtmlFromRichTextWithExtensions` — but none
 *     for plaintext.)
 *   - `toRichText` is pure, but importing it pulls tldraw's runtime.
 *
 * `plainTextToRichText` below mirrors `toRichText` from `@tldraw/tlschema`
 * exactly; if that ever changes shape, this is the thing to re-check.
 *
 * Converting a Node back into a shape goes through `plainTextToRichText`, so
 * **formatting is lost when a canvas is rebuilt from canonical JSON**. That is a
 * deliberate consequence of `NodeContent.text` being a plain string, and it is
 * pinned by a test rather than left to a comment.
 */
import type { TLRichText } from 'tldraw'

interface RichTextNode {
	type?: string
	text?: string
	content?: RichTextNode[]
}

/** Mirrors `toRichText`: each line becomes a paragraph, empty lines stay empty. */
export function plainTextToRichText(text: string): TLRichText {
	const content = text.split('\n').map((line) => {
		if (!line) return { type: 'paragraph' }
		return { type: 'paragraph', content: [{ type: 'text', text: line }] }
	})

	return { type: 'doc', content }
}

/**
 * Depth-first collection of text nodes, with each top-level block becoming its
 * own line. Handles nested structures (lists, marked spans) because marks live
 * on text nodes rather than wrapping them.
 */
export function richTextToPlainText(richText: TLRichText | undefined): string {
	if (!richText) return ''

	const blocks = (richText.content ?? []) as RichTextNode[]
	return blocks.map(collectText).join('\n')
}

function collectText(node: RichTextNode): string {
	if (typeof node.text === 'string') return node.text
	if (node.type === 'hardBreak') return '\n'
	if (!node.content) return ''
	return node.content.map(collectText).join('')
}
