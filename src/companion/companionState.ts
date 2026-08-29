/**
 * The AI companion's cross-cutting UI state.
 *
 * Module-scope tldraw atoms, the same idiom as `showContextualFields`: the two switches,
 * the thinking indicator and the transcript panel are siblings with no common parent, and
 * `components` in `config.tsx` is built once at module scope, so a React provider can't
 * span them without remounting the editor. Atoms are reactive across that gap.
 *
 * Two independent switches, per the MVP-2 spec: `observationEnabled` gates whether the
 * model is consulted at all, `voiceEnabled` gates only speech. Off/off is silent, on/off
 * fills the transcript without speaking, on/on is the full companion. None of this is
 * persisted or canonical — it is preference and transient status, not a fact about the
 * canvas.
 */
import { atom } from 'tldraw'
import { EPISODE_IDLE_MS } from '@/domain'
import type { ClusterPlacement, NodeId } from '@/domain'

/** Whether finalized episodes are sent to the model. Off means the companion is asleep. */
export const observationEnabled = atom('companion observation enabled', true)

/** Whether a spoken comment is played aloud. Off still fills the transcript. */
export const voiceEnabled = atom('companion voice enabled', true)

/**
 * What the companion is busy with, if anything — the state behind the "✦ Agent…" hint.
 *
 * Two working stages rather than one boolean, because the wait is two jobs and takes about
 * five seconds end to end: `observing` is the model deciding whether this change is worth a
 * remark (~3s), `composing` is the sentence being turned into a voice (~2s). Naming them
 * separately is what lets the hint say which one it is in instead of showing the same frozen
 * line for both.
 */
export type CompanionStage = 'idle' | 'observing' | 'composing'

export const companionStage = atom<CompanionStage>('companion stage', 'idle')

/** How the companion is pacing itself: the pause it waits out, and what that cost. */
export interface Pacing {
	/** The quiet the canvas must hold before the next episode closes. */
	idleMs: number
	/** Thoughts killed by the user coming back before one could land. */
	dropped: number
}

/**
 * The adaptive pause, made visible.
 *
 * The pause moves on its own (`createIdleBackoff`), and an invisible number that moves on
 * its own is indistinguishable from a bug the moment it surprises anyone. This is the same
 * argument the event log and the canonical JSON panel already make about spatial state: if
 * the app derives something, the app should be willing to show it. Read by
 * `CompanionControls`, next to the switches that decide whether any of this runs at all.
 */
export const companionPacing = atom<Pacing>('companion pacing', {
	idleMs: EPISODE_IDLE_MS,
	dropped: 0,
})

/** One spoken (or would-be-spoken) observation, with the moment it was made. */
export interface TranscriptEntry {
	comment: string
	at: number
}

/** Recent comments, oldest first. The companion appends; the panel and anti-repetition read. */
export const companionTranscript = atom<TranscriptEntry[]>('companion transcript', [])

/** A remark being spoken right now, and how far through it the voice has got (0–1). */
export interface Utterance {
	comment: string
	fraction: number
}

/**
 * What the companion is saying *as* it says it, or `null` between remarks.
 *
 * Separate from the transcript because the two answer different questions. The transcript
 * is the record — what was decided, kept even when voice is off or playback fails. This is
 * the performance: it exists only while a clip is playing, and it carries the position the
 * bar reveals words against, so the sentence arrives with the sound instead of a synthesis
 * ahead of it. Not persisted, not canonical; `spokenPrefix` in `reveal.ts` does the mapping.
 */
export const companionUtterance = atom<Utterance | null>('companion utterance', null)

/**
 * The notes the current remark is about — highlighted on the canvas while it is spoken, then
 * cleared. Empty when the companion is silent or talking about the board as a whole. Comes from
 * the model's `focus` for reflections, the members for a grouping, or the changed notes for an
 * observation. Module-scope for the same reason as the other companion atoms.
 */
export const companionFocus = atom<NodeId[]>('companion focus', [])

/**
 * A grouping the companion is proposing right now — the ghost preview on the canvas,
 * awaiting accept or dismiss. `null` between proposals.
 *
 * Module-scope for the same reason as the others: the ghost overlay (an `OnTheCanvas`
 * renderer), the accept/dismiss controls and the orchestrator are siblings with no shared
 * React parent. Not persisted, not canonical — a transient proposal about the canvas, not a
 * fact about it. `targets` are world top-lefts, the same frame as `spatial.x/y`.
 */
export interface GroupingSuggestion {
	/** The orchestrator generation that produced it, so a stale ghost can be told apart. */
	generation: number
	members: NodeId[]
	targets: ClusterPlacement[]
	/** The one-line remark the companion spoke when proposing it; captions the ghost. */
	rationale: string
}

export const groupingSuggestion = atom<GroupingSuggestion | null>(
	'companion grouping suggestion',
	null
)

/**
 * Imperative handles the running companion publishes for the module-scope UI to reach across
 * the same provider-less gap the atoms bridge: the "✦ Suggest a grouping" button calls
 * `requestGrouping`, the accept control calls `acceptGrouping`. `null` while no companion is
 * mounted, which is also the controls' disabled state. (Dismiss needs no handle — it just
 * clears `groupingSuggestion`, since it changes nothing on the canvas.)
 */
export const requestGrouping = atom<((context: string) => void) | null>(
	'companion request grouping',
	null
)
export const acceptGrouping = atom<(() => void) | null>('companion accept grouping', null)

/**
 * A new note the reflection is proposing — a ghost on the canvas, awaiting a decision. The
 * model supplies the text and whether it is an idea or a question; the client computes where
 * it would land. On accept it becomes a real, agent-stamped post-it.
 */
export interface GhostIdea {
	/** Stable within one reflection, for React keys and per-idea accept/dismiss. */
	id: string
	text: string
	kind: 'idea' | 'question'
	/** Where the note would land — world top-left, the `spatial.x/y` frame. */
	x: number
	y: number
	/** An existing note this new one would connect to with an arrow, if any. */
	connectTo?: NodeId
	/** The label for that connection. */
	connectLabel?: string
}

/** The reflection's pending new-note proposals, ghost-previewed on the canvas. Empty when none. */
export const ideaSuggestions = atom<GhostIdea[]>('companion idea suggestions', [])

/**
 * A proposed arrow between two existing notes — the "grey arrow" the agent draws. Ghost-previewed
 * dashed on the canvas, awaiting accept or dismiss. `from`/`to` are existing note ids.
 */
export interface GhostRelation {
	id: string
	from: NodeId
	to: NodeId
	label?: string
}

/** The reflection's pending arrow proposals between existing notes. Empty when none. */
export const relationSuggestions = atom<GhostRelation[]>('companion relation suggestions', [])

/**
 * Imperative handles the running companion publishes for the canvas AI buttons and the idea
 * controls. `requestReflection` runs a whole-board reflection; `commitIdeas` turns the named
 * ghost ideas into agent-stamped notes. `null` while no companion is mounted.
 */
export const requestReflection = atom<((persona: string) => void) | null>(
	'companion request reflection',
	null
)
export const commitIdeas = atom<((ideaIds: string[]) => void) | null>('companion commit ideas', null)
export const commitRelations = atom<((relationIds: string[]) => void) | null>(
	'companion commit relations',
	null
)
