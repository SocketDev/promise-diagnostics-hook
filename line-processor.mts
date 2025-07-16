import {
    type Observation,
    InitObservation,
    PromiseResolveObservation,
    BeforeObservation,
    AfterObservation,
    DestroyObservation
} from './observations.mts';
/**
 * This file is a Tuple based line processor
 * It avoids using JSON self describing lines in favor of a more compact
 * tuple based approach.
 * 
 * This file does not do any analysis, it only does simple data transformation
 * from tuples to instances of Observations.
 */
export class LineProcessor<Ctors extends Record<string, Observation<any[], any>> = {}>{
    constructors: Map<keyof Ctors, {
        constructor: Ctors[keyof Ctors],
    } & ({
        field_order: number[],
        max_required_field_index: number,
    } | {
        field_order: null,
        max_required_field_index: null,
    })>

    /**
     * Helper to create a new default LineProcessor with the standard observations.
     */
    static createNewDefaultProcessor() {
        return new LineProcessor({
            init: InitObservation,
            promiseResolve: PromiseResolveObservation,
            before: BeforeObservation,
            after: AfterObservation,
            destroy: DestroyObservation,
        });
    }

    constructor(constructors: Ctors) {
        this.constructors = new Map()
        for (const [name, constructor] of Object.entries(constructors)) {
            if (constructor.fields) {
                this.constructors.set(name as keyof Ctors, {
                    constructor: constructor as Ctors[keyof Ctors],
                    field_order: null,
                    max_required_field_index: null
                })
            }
        }
    }

    /**
     * Process a command line into a given instance;
     * A special 'meta' command is used to set the field order for a given hook.
     * ['meta', hook: string, field_order: string[]]
     * 
     * This will error when expected fields/constructors are not found.
     * This will not error when a field/constructor is not known.
     */
    decode<const K extends keyof Ctors | 'meta'>(cmd: K, args: any[]): K extends 'meta' ? undefined : K extends keyof Ctors ? InstanceType<Ctors[K]> : undefined {
        if (cmd === 'meta') {
            const ctorId = args[0]
            const ctor = this.constructors.get(ctorId as keyof Ctors)
            if (!ctor) {
                return undefined as any
            }
            ctor.field_order = ctor.constructor.fields.map((f: string) => {
                const index = args[1].indexOf(f)
                if (index === -1) {
                    throw new Error(`Field ${f} not found in ${String(ctorId)} meta line`)
                }
                return index
            })
            ctor.max_required_field_index = Math.max(...ctor.field_order)
        } else if (this.constructors.has(cmd as keyof Ctors)) {
            const { constructor, field_order, max_required_field_index } = this.constructors.get(cmd as keyof Ctors)!
            if (!field_order) {
                throw new Error(`No field order for ${String(cmd)}, please send meta line first`);
            } else {
                if (max_required_field_index >= args.length) {
                    throw new Error(`Not enough fields in ${String(cmd)} line, expected at least ${max_required_field_index + 1}, got ${args.length}`); 
                }
                const tupleArgs = field_order.map(index => args[index]) as ConstructorParameters<typeof constructor>;
                return new constructor(...tupleArgs) as InstanceType<typeof constructor> as any;
            }
        }
        return undefined as any
    }

    *meta() {
        for (const [id, ctor] of this.constructors.entries()) {
            yield ['meta', id, ctor.constructor.fields];
        }
    }

    encode<const T extends InstanceType<Ctors[keyof Ctors]>>(obs: T): Parameters<LineProcessor<Ctors>['decode']> {
        for (const [id,ctor] of this.constructors.entries()) {
            if (id === 'promiseResolve') {

            }
            if (typeof id === 'string') {
                if (obs as any instanceof ctor.constructor) {
                    return [id, ...ctor.constructor.fields.map(f => obs[f as keyof T])] as Parameters<LineProcessor<Ctors>['decode']>
                }
            }
        }
        throw new Error(obs.constructor.name + ' is not a known observation type, known types are: ' + Array.from(this.constructors.keys()).join(', '));
    }
}
