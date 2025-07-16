let _ = await 1
// a: 1 alloc
let a = Promise.resolve(0)
// a: 1st unwrap
await a
// a: 2nd + 3rd unwrap
// b: 1 alloc
let b = Promise.all([a,a,{then(f,r) {f(1)}}])
// b: 1st unwrap
// c: 1 alloc
let c = b.then(b => b)
// b: 2nd unwrap
await b

import { EventEmitter } from 'events'
let ee = new EventEmitter()
// ee doesn't actully handle async, so this is seen as waste
// this allocates a promise every time it is called
ee.on('event', async () => {

})
// 10 allocs for promises
for (let i = 0; i < 10; i++) {
    // this causes the handler to be called and alloc a promiose
    ee.emit('event')
}
