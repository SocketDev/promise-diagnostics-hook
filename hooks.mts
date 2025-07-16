import {
  triggerAsyncId,
  createHook,
  executionAsyncId,
  type HookCallbacks,
} from "node:async_hooks"
import fs from 'node:fs'
import {
  type AsyncId,
  InitObservation,
  PromiseResolveObservation,
  BeforeObservation,
  AfterObservation,
  DestroyObservation,
} from './observations.mts'
import {
  threadId
} from 'node:worker_threads'
import path from 'node:path'
import util from 'node:util'
import { LineProcessor } from './line-processor.mts'
const debug = util.debug('promise-diagnostics')

let log: any[] = []
let target = process.env.PROMISE_DIAGNOSTICS_HOOK_LOG
if (!target) {
  target = path.resolve(process.cwd(), `${new Date().toISOString()}.${process.pid}.${threadId}.async_hooks.ndjson`)
}
const fd = fs.openSync(target, 'w', 0o600)
const processor = LineProcessor.createNewDefaultProcessor()
// TODO: this can output a lot of data, we should probably compress it
//       unfortunately, node builtins are tough to use here
//       so we will just write it out as is for now
function writeLineToFile(line: string) {
  fs.writeFileSync(fd, `${line}\n`, {
    encoding: 'utf8',
    flush: true,
  })
}
process.on('exit', () => {
  asyncHook.disable()
  writeLineToFile(JSON.stringify(['end']))
})
for (const meta of processor.meta()) {
  writeLineToFile(JSON.stringify(meta))
}
// THIS CANNOT BE ASYNC, that would infinitely recurse async_hooks
let logAndInsert = function logAndInsert(observation: PromiseResolveObservation | InitObservation | BeforeObservation | AfterObservation | DestroyObservation) {
  writeLineToFile(JSON.stringify(processor.encode(observation)))
}
if (debug.enabled) {
  let $logAndInsert = logAndInsert
  logAndInsert = function logAndInsert(observation) {
    log.push(observation)
    $logAndInsert(observation)
  }
  process.on('beforeExit', () => {
    for (const msg of log) {
      console.warn(msg)
    }
  })
}
function getStack() {
  let oldStackTracer = Error.prepareStackTrace
  let oldLimit = Error.stackTraceLimit
  try {
    Error.stackTraceLimit = Infinity;
    let err = new Error()
    Error.prepareStackTrace = (error, structuredStackTrace) => {
      let stack: string[] = []
      for (const frame of structuredStackTrace) {
        const filename = frame.getFileName()
        if (!filename) {
          continue
        }
        if (filename.startsWith('node:internal/modules/') || filename.startsWith('node:internal/async_hooks')) {
          continue
        }
        // if (frame.isNative()) {
        //   continue
        // }
        if (filename === import.meta.url) {
          continue
        }
        stack.push(filename + ':' + (frame.getLineNumber()??-1) + ':' + (frame.getColumnNumber()??-1))
      }
      return stack.join("\n")
    }
    return err.stack!
  } finally {
    Error.prepareStackTrace = oldStackTracer
    Error.stackTraceLimit = oldLimit
  }
}

const promises: Map<AsyncId, Promise<any>> = new Map()
let hooks: HookCallbacks = {
  promiseResolve(asyncId) {
    process.nextTick(() => {
      logAndInsert(new PromiseResolveObservation(executionAsyncId() as AsyncId, triggerAsyncId() as AsyncId, asyncId as AsyncId, null))
    })
  },
  init(asyncId, type, triggerAsyncId, resource) {
    logAndInsert(new InitObservation(type, executionAsyncId() as AsyncId, triggerAsyncId as AsyncId, asyncId as AsyncId, getStack()))
  },
  before(asyncId) {
    logAndInsert(new BeforeObservation(triggerAsyncId() as AsyncId, asyncId as AsyncId))
  },
  after(asyncId) {
    logAndInsert(new AfterObservation(triggerAsyncId() as AsyncId, asyncId as AsyncId))
  },
  destroy(asyncId) {
    logAndInsert(new DestroyObservation(asyncId as AsyncId))
  },
}
const asyncHook = createHook(hooks)
asyncHook.enable()
