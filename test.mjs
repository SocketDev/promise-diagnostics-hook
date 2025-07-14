// TODO: fix this specific case of promises BETWEEN AWAITS 
let _ = await 1
let a = Promise.resolve(0)
let b = Promise.all([a,{then(f,r) {f(1)}},a])
let c = b.then(b => b)
await b
