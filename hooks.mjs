import {
  triggerAsyncId,
  createHook,
  executionAsyncId,
} from "node:async_hooks"
import fs from 'node:fs'
import { debug as createDebug } from "node:util"

let log_raw = new Set()
for (const id of (process.env.PROMISE_MISUSE_RAW || '').split(',')) {
  if (id) {
    log_raw.add(parseFloat(id))
  }
}
const debug = createDebug('promise_misuse')
const verbose = process.env.PROMISE_MISUSE_VERBOSE === '1' || false

function indent(str, prefix = "  ") {
  return str.replace(/^/gm, prefix)
}

if (debug.enabled) {
  process.on("beforeExit", () => {
    if (log.length > 0) {
      for (const msg of log) {
        console.warn(msg)
      }
    }
  })
}

export function msg(str) {
  log.push(str)
}

let start = null
let ticks = 0
let promises = new Map()
let destroyed = []
let log = []
let lastExecutingAsyncId = null

const ModuleInitsSeen = new Set()
function getStack() {
  let oldStackTracer = Error.prepareStackTrace
  let err = new Error()
  try {
    Error.prepareStackTrace = (error, structuredStackTrace) => {
      let stack = []
      for (const frame of structuredStackTrace) {
        if (!frame.getFileName()) {
          continue
        }
        if (frame.isNative()) {
          continue
        }
        if (frame.getFileName()?.startsWith("node:")) {
          continue
        }
        //
        if (frame.getLineNumber() === 1 && frame.getColumnNumber() === 1) {
          // when a module containing `await` is loaded it fires an async hook
          // but we don't want to listen for this as it is purely noise outside
          // of programmer control
          // HOWEVER, we need to detect modules that start with `await` so we
          // have to only ignore the first occurance at start of module
          if (!ModuleInitsSeen.has(frame.getFileName())) {
            ModuleInitsSeen.add(frame.getFileName())
            return ''
          }
        }
        if (frame.getFileName() === import.meta.url) {
          continue
        }
        stack.push(frame.toString())
      }
      return stack.join("\n")
    }
    return err.stack
  } finally {
    Error.prepareStackTrace = oldStackTracer
  }
}
let lastInitStack = null
let hooks = {
  promiseResolve(asyncId) {
    if (debug.enabled) {
      log.push(
        `promiseResolve: asyncId=${asyncId}, triggerAsyncId=${triggerAsyncId()}, running=${executionAsyncId()}`
      )
    }
    if (executionAsyncId() === asyncId) {
      let existing = promises.get(asyncId)
      if (existing) {
        let queuedDuringData = promises.get(existing.queuedDuring)
        if (queuedDuringData) {
          queuedDuringData.continuedBy ||= new Map()
          let continueStack = existing.allocatedAt
          let existingContinues = queuedDuringData.continuedBy.get(continueStack) || []
          existingContinues.push(asyncId)
          queuedDuringData.continuedBy.set(continueStack, existingContinues)
          queuedDuringData.asyncUnwraps++
        }
        existing.evaluated = true
      }
    }
  },
  init(asyncId, type, triggerAsyncId, resource) {
    let running = executionAsyncId()
    const stack = getStack()
    if (debug.enabled) {
      log.push(
        `init: running=${running} asyncId=${asyncId}, type=${type}, triggerAsyncId=${triggerAsyncId}, allocatedAt=${stack}`
      )
    }
    if (type === "PROMISE") {
      let registeringHandler = running !== triggerAsyncId
      let cause = promises.get(triggerAsyncId)
      // if we know we are in a handler of another promise and we are awaiting a promise
      // that means that this promise is depending on and has unwrapped the previous promise
      if (cause && registeringHandler) {
        let unwraps = cause.unwrapExecutionStartStacks.get(stack) ?? []
        unwraps.push(asyncId)
        cause.unwrapExecutionStartStacks.set(stack, unwraps)
        cause.asyncUnwraps++
      }
      let evaluated = false
      let asyncUnwraps = 0
      // HACK: this relies on internal promise creation ordering in v8
      if (stack === lastInitStack && running !== triggerAsyncId) {
        // we just have to lie due to internal Promise.* listeners
        asyncUnwraps++
      } else {
        // Promise.all/race/allSettled all defer to running context for outer promise
        if (running === triggerAsyncId) {
          lastInitStack = stack
        } else {
          lastInitStack = null
        }
      }
      let data = {
        // resource,
        asyncId,
        evaluated,
        asyncUnwraps,
        allocatedAt: stack,
        queuedDuring: running,
        unwrapExecutionStartStacks: new Map(),
      }
      if (log_raw.has(asyncId)) {
        log.push('raw (NOTE: live at end of process, not snapshot):')
        log.push(data)
      }
      promises.set(asyncId, data)
    }
  },
  before(asyncId) {
    lastInitStack = null
    let executing = promises.get(asyncId)
    if (debug.enabled) {
      log.push(
        `before: asyncId=${asyncId}, triggerAsyncId=${triggerAsyncId()}, queuedDuring=${
          executing?.queuedDuring
        }`
      )
    }
    if (executing) {
      lastExecutingAsyncId = asyncId
    }
    ticks++
  },
  after(asyncId) {
    let executing = promises.get(asyncId)
    if (debug.enabled) {
      log.push(
        `after: asyncId=${asyncId}, triggerAsyncId=${triggerAsyncId()}, queuedDuring=${
          executing?.queuedDuring
        }`
      )
    }
  },
  destroy(asyncId) {
    if (debug.enabled) {
      log.push(`destroy: asyncId=${asyncId}`)
    }
    let data = promises.get(asyncId)
    if (data) {
      destroyed.push(data)
      promises.delete(asyncId)
    }
  },
}
const asyncHook = createHook(hooks)
export function flush() {
  let msgs = [
    `Promise diagnostics for ${ticks} ticks ( ${start}/${new Date().toISOString()} ):`,
  ]
  start = null
  function diagnostics({
    asyncId,
    asyncUnwraps,
    allocatedAt,
    evaluated,
    unwrapExecutionStartStacks,
    continuedBy
  }) {
    if (asyncId === lastExecutingAsyncId && !verbose) {
      return
    }
    if (!allocatedAt && !verbose) {
      return
    }
    if (asyncUnwraps === 0) {
      // HACK: .then and await both look the same via async_hooks
      //       we must differentiate in source code instead
        if (evaluated) {
          let parts = allocatedAt.split(':')
          let col = +parts.pop()
          let line = +parts.pop()
          let url = parts.join(':')
          const body = `${fs.readFileSync(new URL(url), 'utf8')}`
          // we can stop at line since it is 1 indexed
          const linesRelevant = body.split('\n', line)
          // we want to drop the last line for easier calculations
          const lineBody = linesRelevant.pop()
          if (lineBody) {
            // 1 indexed needs to be converted to 0 indexed
            // only need to check if we are at an `await`
            const indexThatMayBeAnAwait = ((linesRelevant.join('\n').length)+1) + col - 1
            // we can just check for if it is an `await` identifier token that isn't prefixed by `.`
            // TODO: technically `await` is not reserved in sloppy and we should detect that
            //       due to things like `function foo(await) {return await}` but that is a very rare case
            // This is a sticky regex so we can use lookbehind and lookahead
            let awaitRegex = /(?<=([^\.]|^)\s*)await(?=\b)/gy
            awaitRegex.lastIndex = indexThatMayBeAnAwait
            let isAwait = awaitRegex.test(body)
            // IF IT IS NOT AN AWAIT
            // we can assume that it is a Promise that was allocated but never unwrapped
            // this happens during .then
            if (!isAwait) {
              evaluated = false
            }
          }
        }

        if (!evaluated) {
            msgs.push(
                indent(
                `Promise ${asyncId} was allocated and never unwrapped, this is due to not reaching the handler due to abort or a Promise being allocated when it isn't needed.` +
                    `\n` +
                    "  ALLOCATED AT:" +
                    "\n" +
                    indent(allocatedAt, '    ')
                )
            )
        }
    } else if (asyncUnwraps > 1 || verbose) {
      let unwrapsLines = []
      for (const [startStack, unwraps] of unwrapExecutionStartStacks) {
        unwrapsLines.push(
          indent(`UNWRAP AT (via ${unwraps}):` + "\n" + indent(startStack))
        )
      }
      for (const [continueStack, continues] of continuedBy || []) {
        unwrapsLines.push(
          indent(`CONTINUE AT (via ${continues}):` + "\n" + indent(continueStack))
        )
      }
      msgs.push(
        indent(
          `Promise ${asyncId} was allocated and unwrapped ${asyncUnwraps} times, consider cacheing the result instead of allocating extraneous ticks.` +
            `\n` +
            indent(`ALLOCATED AT:\n` +
            indent(allocatedAt) +
            "\n" +
            unwrapsLines.join("\n"))
        )
      )
    }
  }
  for (let data of promises.values()) {
    diagnostics(data)
  }
  // WE DO NOT CLEAR promises here, as they may still be destroyed later
  // promises.clear()
  for (let data of destroyed) {
    diagnostics(data)
  }
  destroyed.length = 0
  return msgs
}
export function enable() {
  start = new Date().toISOString()
  if (!asyncHook.enabled) {
    asyncHook.enable()
    log.push(`Async hooks enabled at ${executionAsyncId()}`)
  }
}
export function disable() {
  if (asyncHook.enabled) {
    asyncHook.disable()
  }
}

function logHookDiagnostics() {
  for (const msg of flush()) {
    console.warn(msg)
  }
} 
process.on("beforeExit", () => {
  logHookDiagnostics()
})
enable()
