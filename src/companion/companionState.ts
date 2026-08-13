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

/** True while the model is deciding whether to speak — drives the "✦ Agent thinking…" hint. */
export const companionThinking = atom('companion thinking', false)

/** One spoken (or would-be-spoken) observation, with the moment it was made. */
export interface TranscriptEntry {
	comment: string
	at: number
}

/** Recent comments, oldest first. The companion appends; the panel and anti-repetition read. */
export const companionTranscript = atom<TranscriptEntry[]>('companion transcript', [])
