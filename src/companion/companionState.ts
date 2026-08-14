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
