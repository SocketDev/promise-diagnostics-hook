import { AnalysisStateMachine, PromiseState } from './analysis.mts'
let target = process.env.PROMISE_DIAGNOSTICS_HOOK_LOG
if (!target) {
    throw new Error('PROMISE_DIAGNOSTICS_HOOK_LOG environment variable must be set to a file path')
}
import fs from 'node:fs'
import { LineProcessor } from './line-processor.mts'

async function* tailFileLines(filePath) {
    const bufferSize = 100//1024 * 4
    const buffer = new Uint8Array(bufferSize)
    const fd = await fs.promises.open(filePath, 'r')
    let position = 0
    let leftover = new Uint8Array(0)

    async function* drain() {
        let current_eof = (await fd.stat()).size
        while (true) {
            // this could be after many reads so we want to sanity check before waiting on a change event
            current_eof = (await fd.stat()).size
            if (position >= current_eof) {
                break
            }
            const decoder = new TextDecoder()
            while (position < current_eof) {
                const { bytesRead } = await fd.read(buffer, 0, bufferSize, position)
                position += bytesRead
                let tmp = new Uint8Array(leftover.byteLength + bytesRead)
                tmp.set(leftover, 0)
                tmp.set(buffer.subarray(0, bytesRead), leftover.byteLength)
                leftover = tmp
                let newlineIndex = leftover.indexOf('\n'.charCodeAt(0))
                while (newlineIndex !== -1) {
                    const line = decoder.decode(leftover.subarray(0, newlineIndex))
                    leftover = leftover.subarray(newlineIndex + 1)
                    yield line
                    newlineIndex = leftover.indexOf('\n'.charCodeAt(0))
                }
                if (bytesRead === 0) {
                    break // No more data to read?
                }
            }
        }
    }

    try {
        yield* drain()
        let watcher = fs.promises.watch(filePath, { persistent: true })
        for await (const info of watcher) {
            if (info.eventType === 'change') {
                yield* drain()
            }
        }
    } finally {
        await fd.close()
    }
}

let analysis = new AnalysisStateMachine()
const lineProcessor = LineProcessor.createNewDefaultProcessor()
for await (const line of tailFileLines(target)) {
    try {
        let cmd = JSON.parse(line)
        if (cmd[0] === 'end') {
            break
        }
        analysis.insertNextObservation(lineProcessor.decode(cmd[0], cmd.slice(1)))
    } catch (e) {
        console.error('Error processing line:', line, e)
    }
}

// 
const unused_allocations: Map<string, PromiseState[]> = new Map()
const overused_allocations_to_unwraps: Map<string, Map<string, PromiseState[]>> = new Map()
for (const msg of analysis.end()) {
    let log = false
    if (!msg.init.stack) {
        continue
    }
    // ignore promises that are not directly allocated due to user code
    if (/^(node:[^\n]*(\n|$))*$/.test(msg.init.stack)) {
        continue
    }
    // some v8 promises are allocated due to user code but are internal and
    // often missing linkage, this leads to them being too noisy
    if (msg.internal) {
        continue
    }
    if (msg.unwrappedBy.size === 0) {
        if (msg.isModuleInitialization) {
            continue
        }
        if (msg.executed) {
            if (msg.isAwait) {
                continue
            }
        }
        log = true
    } else if (msg.unwrappedBy.size > 1) {
        log = true
    }
    if (log) {
        if (msg.unwrappedBy.size === 0) {
            const shared_allocs = unused_allocations.get(msg.init.stack) ?? []
            shared_allocs.push(msg)
            unused_allocations.set(msg.init.stack, shared_allocs)
        } else {
            const shared_allocs = overused_allocations_to_unwraps.get(msg.init.stack) ?? new Map()
            overused_allocations_to_unwraps.set(msg.init.stack, shared_allocs)
            for (const unwrappedBy of msg.unwrappedBy) {
                const unwrapStack = analysis.promises.get(unwrappedBy)!.init.stack
                const shared_unwraps = shared_allocs.get(unwrapStack) ?? []
                shared_unwraps.push(msg)
                shared_allocs.set(unwrapStack, shared_unwraps)
            }
        }
    }
}
analysis = null
for (const [stack, allocs] of unused_allocations) {
    console.group(`Unused Promise ${allocs.map(a => a.init.asyncId).join(', ')} (allocated ${allocs.length} times):`)
    console.log(stack)
    console.groupEnd()
}
for (const [stack, unwraps] of overused_allocations_to_unwraps) {
    console.group(`Overused Promise times:`)
    console.log(stack)
    for (const [unwrapStack, allocs] of unwraps) {
        console.group(`Unwrapped ${allocs.length} times (${allocs.map(a => a.init.asyncId).join(', ')}) at:`)
        console.log(unwrapStack)
        console.groupEnd()
    }
    console.groupEnd()
}
