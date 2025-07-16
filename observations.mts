import util from 'node:util'
export interface Observation<Fields extends readonly string[], Instance extends Record<Fields[number], any>> {
    new (...args: any[]): Instance;
    fields: Fields;
}
export type AsyncId = number & { _tag: 'AsyncId' }
export class InitObservation {
    static readonly fields = [
        'type',
        'executionAsyncId',
        'triggerAsyncId',
        'asyncId',
        'stack',
    ]
    readonly type: string
    readonly executionAsyncId: AsyncId
    readonly triggerAsyncId: AsyncId
    readonly asyncId: AsyncId
    readonly stack: string
    constructor(
        type: string,
        executionAsyncId: AsyncId,
        triggerAsyncId: AsyncId,
        asyncId: AsyncId,
        stack: string,
    ) {
        this.type = type
        this.executionAsyncId = executionAsyncId
        this.triggerAsyncId = triggerAsyncId
        this.asyncId = asyncId
        this.stack = stack
    }
    [util.inspect.custom]() {
        return `InitObservation(type=${this.type}, executionAsyncId=${this.executionAsyncId}, triggerAsyncId=${this.triggerAsyncId}, asyncId=${this.asyncId}, stack=${this.stack})`
    }
}
export class PromiseResolveObservation {
    static readonly fields = ['executionAsyncId', 'triggerAsyncId', 'asyncId', 'inspected']
    readonly executionAsyncId: AsyncId
    readonly triggerAsyncId: AsyncId
    readonly asyncId: AsyncId
    readonly inspected: string
    constructor(
        executionAsyncId: AsyncId,
        triggerAsyncId: AsyncId,
        asyncId: AsyncId,
        inspected: string
    ) {
        this.executionAsyncId = executionAsyncId
        this.triggerAsyncId = triggerAsyncId
        this.asyncId = asyncId
        this.inspected = inspected
    }
    [util.inspect.custom]() {
        return `PromiseResolveObservation(executionAsyncId=${this.executionAsyncId}, triggerAsyncId=${this.triggerAsyncId}, asyncId=${this.asyncId}, inspected=${this.inspected})`
    }
}
export class BeforeObservation {
    static readonly fields = ['triggerAsyncId', 'asyncId']
    readonly triggerAsyncId: AsyncId
    readonly asyncId: AsyncId
    constructor(
        triggerAsyncId: AsyncId,
        asyncId: AsyncId
    ) {
        this.triggerAsyncId = triggerAsyncId
        this.asyncId = asyncId
    }
    [util.inspect.custom]() {
        return `BeforeObservation(triggerAsyncId=${this.triggerAsyncId}, asyncId=${this.asyncId})`
    }
}
export class AfterObservation {
    static readonly fields = ['triggerAsyncId', 'asyncId']
    readonly triggerAsyncId: AsyncId
    readonly asyncId: AsyncId
    constructor(
        triggerAsyncId: AsyncId,
        asyncId: AsyncId
    ) {
        this.triggerAsyncId = triggerAsyncId
        this.asyncId = asyncId
    }
    [util.inspect.custom]() {
        return `AfterObservation(triggerAsyncId=${this.triggerAsyncId}, asyncId=${this.asyncId})`
    }
}
export class DestroyObservation {
    static readonly fields = ['asyncId']
    readonly asyncId: AsyncId
    constructor(
        asyncId: AsyncId
    ) {
        this.asyncId = asyncId
    }
    [util.inspect.custom]() {
        return `DestroyObservation(asyncId=${this.asyncId})`
    }
}
