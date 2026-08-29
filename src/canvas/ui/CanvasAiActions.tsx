/**
 * The companion's on-demand actions, on the canvas.
 *
 * Two buttons sit beside the four tools: suggest a grouping, or reflect on the whole board.
 * They are the companion's, so they live with the tools the user reaches for rather than in a
 * settings menu.
 *
 * Each asks first. Grouping asks what to organise by — preset intents plus a freeform field.
 * Reflection asks which lens to look through — critique, analyzer, gap-finder, synthesizer — so
 * the same board can be read for what is weak, what its structure is, what is missing, or what
 * it is becoming. The prompt opens over the button; picking runs it.
 *
 * Each button is disabled when the companion is asleep (observation off), unmounted (no handle),
 * or already has a proposal waiting to be decided — the orchestrator's own guards, so a button
 * can never request something the loop would drop.
 */
import { useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, useValue } from 'tldraw'
import {
	groupingSuggestion,
	ideaSuggestions,
	observationEnabled,
	relationSuggestions,
	requestGrouping,
	requestReflection,
} from '@/companion/companionState'
import { caption, numberInput, panelButton, panelChrome } from '@/canvas/ui/theme'

/** Quick starting points for a grouping intent; the freeform field covers everything else. */
const PRESETS = [
	{ label: 'By theme', intent: 'group by theme' },
	{ label: 'By feature area', intent: 'group by feature area' },
	{ label: 'By priority', intent: 'group by priority' },
	{ label: 'By stage', intent: 'group by user-journey stage' },
]

/** The reflection lenses. Ids match `REFLECT_PERSONAS` on the server. */
const PERSONAS = [
	{ id: 'critique', label: 'Critique' },
	{ id: 'analyzer', label: 'Analyzer' },
	{ id: 'gap-finder', label: 'Gap finder' },
	{ id: 'synthesizer', label: 'Synthesizer' },
]

type OpenPrompt = null | 'grouping' | 'reflect'

/**
 * Both prompts float above the toolbar, portalled to the editor container: tldraw's toolbar
 * clips and under-layers an absolutely-positioned child, so an inline popover would vanish
 * behind the canvas. The container root escapes both and still carries the theme variables.
 */
const promptStyle: CSSProperties = {
	...panelChrome,
	position: 'fixed',
	bottom: 72,
	left: '50%',
	transform: 'translateX(-50%)',
	zIndex: 400,
	width: 320,
	padding: 'var(--tl-space-3)',
	display: 'flex',
	flexDirection: 'column',
	gap: 'var(--tl-space-2)',
}

export function CanvasAiActions() {
	const editor = useEditor()
	const observing = useValue(observationEnabled)
	const grouping = useValue(requestGrouping)
	const reflecting = useValue(requestReflection)
	const groupingPending = useValue(groupingSuggestion)
	const ideas = useValue(ideaSuggestions)
	const relations = useValue(relationSuggestions)

	const [openPrompt, setOpenPrompt] = useState<OpenPrompt>(null)
	const [intent, setIntent] = useState('')

	// A decision is already on the canvas; settle it before asking for another.
	const busy = groupingPending !== null || ideas.length > 0 || relations.length > 0
	const toggle = (which: 'grouping' | 'reflect') =>
		setOpenPrompt((open) => (open === which ? null : which))

	const submitGrouping = (value: string) => {
		const text = value.trim()
		if (!text) return
		grouping?.(text)
		setIntent('')
		setOpenPrompt(null)
	}

	const submitReflection = (persona: string) => {
		reflecting?.(persona)
		setOpenPrompt(null)
	}

	return (
		<div
			style={{
				display: 'flex',
				gap: 4,
				alignItems: 'center',
				marginLeft: 4,
				paddingLeft: 8,
				// Matches the toolbar's own left inset, so the last action isn't flush to the edge.
				paddingRight: 8,
				borderLeft: '1px solid var(--tl-color-divider)',
			}}
		>
			<button
				type="button"
				style={panelButton}
				disabled={!grouping || !observing || busy}
				onClick={() => toggle('grouping')}
				title="Suggest a grouping of related ideas"
			>
				✦ Suggest a grouping
			</button>

			{openPrompt === 'grouping' &&
				grouping &&
				createPortal(
					<div
						data-grouping-prompt=""
						onPointerDown={(event) => event.stopPropagation()}
						style={promptStyle}
					>
						<span style={caption}>What should this grouping be organised by?</span>
						<div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
							{PRESETS.map((preset) => (
								<button
									key={preset.intent}
									type="button"
									data-grouping-preset=""
									style={panelButton}
									onClick={() => submitGrouping(preset.intent)}
								>
									{preset.label}
								</button>
							))}
						</div>
						<div style={{ display: 'flex', gap: 4 }}>
							<input
								value={intent}
								onChange={(event) => setIntent(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter') submitGrouping(intent)
									if (event.key === 'Escape') setOpenPrompt(null)
								}}
								placeholder="or describe how to group…"
								autoFocus
								style={{ ...numberInput, flex: 1 }}
							/>
							<button
								type="button"
								data-grouping-submit=""
								style={panelButton}
								disabled={!intent.trim()}
								onClick={() => submitGrouping(intent)}
							>
								Group
							</button>
						</div>
					</div>,
					editor.getContainer()
				)}

			<button
				type="button"
				style={panelButton}
				disabled={!reflecting || !observing || busy}
				onClick={() => toggle('reflect')}
				title="Reflect on the whole board through a chosen lens"
			>
				✦ Reflect on board
			</button>

			{openPrompt === 'reflect' &&
				reflecting &&
				createPortal(
					<div
						data-reflect-prompt=""
						onPointerDown={(event) => event.stopPropagation()}
						style={promptStyle}
					>
						<span style={caption}>Reflect through which lens?</span>
						<div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
							{PERSONAS.map((persona) => (
								<button
									key={persona.id}
									type="button"
									data-reflect-persona=""
									style={panelButton}
									onClick={() => submitReflection(persona.id)}
								>
									{persona.label}
								</button>
							))}
						</div>
					</div>,
					editor.getContainer()
				)}
		</div>
	)
}
