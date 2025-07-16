import fs from 'fs'
import { type AsyncId, BeforeObservation, InitObservation, type Observation, PromiseResolveObservation } from './observations.mts'

export class PromiseState {
    init: InitObservation
    /**
     * This state is set when an Execution context (before/after)
     * is seen to resolve the same promise as its own id.
     * 
     * It represents that the promise was some kind of execution and not
     * a simple data allocation (unlike Promise.resolve or other coercion).
     * 
     * This is used as a noise reduction mechanism for cases where Promises
     * represent state machine management and not data management.
     */
    executed: boolean = false
    /**
     * Due to how `Promise.prototype.then` works, it is not possible to
     * differentiate between an allocated promise from .then() and an await
     * 
     * E.G.
     * 
     * ```mjs
     * a.then(() => {...})
     * await a
     * ```
     * 
     * Send the same order of events, triggers, execution ids, etc.
     * 
     * This boolean is used to state through out of band data that Promise is
     * being used as an await and not a simple data allocation.
     * 
     * Since it requires fetching source and parsing, this is done lazily
     * and only when trying to finalize the analysis if necessary.
     */
    isAwait: boolean | null = null
    isModuleInitialization: boolean
    internal: boolean = false
    /**
     * Any other promise that derives its value from this promise;
     * Heuristics like `executed` and `isAwait` are used to determine
     * if this is not data flow based but continuation flow instead and ignore this field.
     */
    unwrappedBy: Set<AsyncId> = new Set()
    constructor(init: InitObservation, isModuleInitialization: boolean) {
        this.init = init
        this.isModuleInitialization = isModuleInitialization
    }
}
export class AnalysisStateMachine {
    /**
     * The last executing async ID needs to be tracked since at the end of a program
     * the last executing async ID will look to never be used, but it is simply the
     * terminating async ID for the program. We need to omit this from being considered
     * a Promise that is never unwrapped.
     */
    lastExecutingAsyncId: AsyncId | null = null;
    /**
     * This is the last stack trace that was seen for an InitObservation that was
     * created using Promise.resolve() or Promise.all(), etc.
     * 
     * This is needed due to internal allocations done by V8 that share the same
     * stack but that have async ids that do not correspond to other ids.
     * 
     * When an API based Promise is created, we batch all the immediately following
     * InitObservations with the same stack and treat them as being executed automatically
     */
    currentAPIBasedInitState: PromiseState | null = null;
    /**
     * Files with async contexts (top level await, etc.) will allocate a Promise for
     * itself when starting execution, those promises will be omitted from being
     * considered as never unwrapped.
     * 
     * The stack trace for the init observation will match the file://path/to/name:1:1
     * and the first instance of that stack trace needs to be ignored.
     */
    initializedURLs: Set<string> = new Set()
    /**
     * ALL the promises that have been created in the program.
     * These will not be removed even when `destroy` is seen due to needing
     * backreferences for analysis.
     */
    promises: Map<AsyncId, PromiseState> = new Map();
    insertNextObservation(observation: Observation<any[], any>) {
        if (observation instanceof InitObservation) {
            if (observation.type !== 'PROMISE') {
                return
            }
            let isModuleInitialization = false
            let url_line_column_pattern = /^(?<url>[^\n]+):(?<line>\d+):(?<column>\d+)$/gy
            let match = url_line_column_pattern.exec(observation.stack)
            if (match) {
                if (match.groups!.line === '1' && match.groups!.column === '1') {
                    if (!this.initializedURLs.has(match.groups!.url!)) {
                        this.initializedURLs.add(match.groups!.url!)
                        isModuleInitialization = true
                    }
                }
            }
            let state = new PromiseState(observation, isModuleInitialization)
            let registeringHandler = observation.executionAsyncId !== observation.triggerAsyncId
            let cause = this.promises.get(observation.triggerAsyncId)
            let stack = observation.stack
            // if we know we are in a handler of another promise and we are awaiting a promise
            // that means that this promise is depending on and has unwrapped the previous promise
            if (cause && registeringHandler) {
                cause.unwrappedBy.add(observation.asyncId)
            }
            let executed = false
            // HACK: this relies on internal promise creation ordering in v8
            if (this.currentAPIBasedInitState && stack === this.currentAPIBasedInitState.init.stack && registeringHandler) {
                // we just have to lie due to internal Promise.* listeners
                // @ts-ignore
                state.internal = true
            } else {
                // Promise.all/race/allSettled all defer to running context for outer promise
                if (!registeringHandler) {
                    this.currentAPIBasedInitState = state
                } else {
                    this.currentAPIBasedInitState = null
                }
            }
            state.executed = executed
            this.promises.set(observation.asyncId, state)
        } else if (observation instanceof PromiseResolveObservation) {
            if (observation.executionAsyncId === observation.asyncId) {
                let existing = this.promises.get(observation.asyncId)
                if (existing) {
                    existing.executed = true
                }
            }
        } else if (observation instanceof BeforeObservation) {
            this.currentAPIBasedInitState = null
            let executing = this.promises.get(observation.asyncId)
            if (executing) {
                this.lastExecutingAsyncId = observation.asyncId
            }
        }
    }
    *end() {
        Object.freeze(this)
        for (const [asyncId, state] of this.promises.entries()) {
            let isAwait = false
            if (state.executed) {
                if (state.init.stack.startsWith('file://')) {
                    let parts = state.init.stack.split('\n')[0]!.split(':')
                    if (parts.length < 3) {
                        debugger
                        continue
                    }
                    let colStr = parts.pop()
                    let col = parseFloat(colStr!)
                    let lineStr = parts.pop()
                    let line = parseFloat(lineStr!)
                    let url = parts.join(':')
                    const body = fs.readFileSync(new URL(url), 'utf8')
                    // we can stop at line since it is 1 indexed
                    const linesRelevant = body.split('\n', line)
                    // we want to drop the last line for easier calculations
                    const lineBody = linesRelevant.pop()
                    if (lineBody) {
                        // 1 indexed needs to be converted to 0 indexed
                        // only need to check if we are at an `await`
                        const indexThatMayBeAnAwait = ((linesRelevant.join('\n').length) + 1) + col - 1
                        // we can just check for if it is an `await` identifier token that isn't prefixed by `.`
                        // TODO: technically `await` is not reserved in sloppy and we should detect that
                        //       due to things like `function foo(await) {return await;}` but that is a very rare case
                        // This is a sticky regex so we can use lookbehind and lookahead
                        let awaitRegex = /(?<=([^\.]|^)\s*)await(?=\b)/gy
                        awaitRegex.lastIndex = indexThatMayBeAnAwait
                        isAwait = awaitRegex.test(body)
                    }
                }
            }
            state.isAwait = isAwait
            yield state
        }
    }
}
