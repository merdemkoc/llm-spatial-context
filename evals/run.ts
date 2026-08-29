/**
 * Measure the observer against the corpus.
 *
 * Deliberately not a vitest suite: `vite.config.ts` includes only `src/**`, and this calls a
 * paid API. It must never run as a side effect of `npm test`. Run it on purpose —
 * `npm run eval` — when a prompt changes, and put the table in the PR.
 *
 * What it reports is the thing the render tests cannot: not what the model was shown, but
 * what it decided. Silence is the outcome under test, so a run that gets every `speak` case
 * right and half the `silent` cases wrong is a failing run even though accuracy reads 75%.
 *
 * Usage:
 *   npm run eval                    # 3 runs per fixture at the default effort
 *   RUNS=5 npm run eval             # more samples per fixture
 *   OBSERVER_EFFORT=low npm run eval  # the Phase 4 probe
 */
import { FIXTURES, type Fixture } from './episodes.ts'
import { observe } from '../server/observe.ts'
import { observerEffort, observerModel } from '../server/prompt.ts'

// Load .env before anything reads it, exactly as `server/index.ts` does.
try {
	process.loadEnvFile()
} catch {
	// No .env — rely on real environment variables.
}

/** The observer's own style rule, measured rather than enforced. */
const REMARK_CHAR_TARGET = 140

/** Theme names the observer must not simply read back. */
const THEME_NAMES = ['Deal friction', 'Getting started']

interface Trial {
	fixture: Fixture
	spoke: boolean
	comment: string
	ms: number
	failed: boolean
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0
	const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
	return sorted[index]
}

async function trial(fixture: Fixture): Promise<Trial> {
	const started = performance.now()
	try {
		const decision = await observe(fixture.payload)
		return {
			fixture,
			spoke: decision.speak,
			comment: decision.comment,
			ms: performance.now() - started,
			failed: false,
		}
	} catch (error) {
		console.error(`  ! ${fixture.name}: ${(error as Error).message}`)
		return { fixture, spoke: false, comment: '', ms: performance.now() - started, failed: true }
	}
}

async function main() {
	const runs = Number(process.env.RUNS ?? 3)
	const effort = observerEffort()
	console.log(
		`model=${observerModel()} effort=${effort ?? '(api default)'} runs=${runs} fixtures=${FIXTURES.length}`
	)
	console.log(`${FIXTURES.length * runs} calls to a paid API.\n`)

	const trials: Trial[] = []
	for (const fixture of FIXTURES) {
		// Sequential on purpose: this measures latency, and concurrent calls contend.
		const results: Trial[] = []
		for (let run = 0; run < runs; run++) results.push(await trial(fixture))
		trials.push(...results)

		const spoke = results.filter((r) => r.spoke).length
		const agreed = fixture.expect === 'speak' ? spoke : runs - spoke
		const mark = agreed === runs ? '  ok' : agreed === 0 ? 'MISS' : 'flak'
		const sample = results.find((r) => r.comment)?.comment ?? ''
		console.log(
			`${mark}  ${fixture.name.padEnd(30)} want=${fixture.expect.padEnd(6)} spoke ${spoke}/${runs}` +
				(sample ? `\n        "${sample}"` : '')
		)
	}

	const usable = trials.filter((t) => !t.failed)
	const failures = trials.length - usable.length

	// The confusion matrix, named the way the product thinks about it.
	const spokeWhenWanted = usable.filter((t) => t.fixture.expect === 'speak' && t.spoke).length
	const silentWhenWanted = usable.filter((t) => t.fixture.expect === 'silent' && !t.spoke).length
	const wantedSpeak = usable.filter((t) => t.fixture.expect === 'speak').length
	const wantedSilent = usable.filter((t) => t.fixture.expect === 'silent').length
	const overSpeaking = wantedSilent - silentWhenWanted
	const missed = wantedSpeak - spokeWhenWanted

	const latencies = usable.map((t) => t.ms).sort((a, b) => a - b)
	const lengths = usable.filter((t) => t.spoke).map((t) => t.comment.length)
	const overTarget = lengths.filter((n) => n > REMARK_CHAR_TARGET).length
	const narrated = usable.filter(
		(t) => t.spoke && THEME_NAMES.some((n) => t.comment.includes(n))
	).length

	const pct = (n: number, of: number) =>
		of === 0 ? '  n/a' : `${((100 * n) / of).toFixed(0).padStart(3)}%`

	console.log('\n──────────────────────────────────────────────')
	console.log(`model                ${observerModel()}`)
	console.log(`effort               ${effort ?? '(api default)'}`)
	console.log(`usable trials        ${usable.length}${failures ? `  (${failures} failed)` : ''}`)
	console.log('')
	console.log(
		`spoke when wanted    ${spokeWhenWanted}/${wantedSpeak}   ${pct(spokeWhenWanted, wantedSpeak)}`
	)
	console.log(
		`silent when wanted   ${silentWhenWanted}/${wantedSilent}   ${pct(silentWhenWanted, wantedSilent)}`
	)
	console.log(
		`over-speaking        ${overSpeaking}/${wantedSilent}   ${pct(overSpeaking, wantedSilent)}  <- the failure mode`
	)
	console.log(`missed a real change ${missed}/${wantedSpeak}   ${pct(missed, wantedSpeak)}`)
	console.log('')
	console.log(`overall speak rate   ${pct(usable.filter((t) => t.spoke).length, usable.length)}`)
	console.log(
		`latency p50 / p95    ${percentile(latencies, 50).toFixed(0)}ms / ${percentile(latencies, 95).toFixed(0)}ms`
	)
	if (lengths.length > 0) {
		const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length
		console.log(
			`remark chars mean/max ${mean.toFixed(0)} / ${Math.max(...lengths)}` +
				`   over ${REMARK_CHAR_TARGET}: ${overTarget}/${lengths.length}`
		)
	}
	console.log(
		`narrated a theme      ${narrated}/${usable.filter((t) => t.spoke).length}   <- must stay 0`
	)
	console.log('──────────────────────────────────────────────')
}

await main()
