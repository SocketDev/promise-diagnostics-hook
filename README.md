# Promise Diagnostics Hook

## Usage

This is a module intended to be preloaded using `--import`.

```sh
node --import @socketsecurity/promise-diagnostics-hook/register
```

To include debugging you can see the full list of logs for async hooks and even see results for a specific id.

```sh
NODE_DEBUG=promise_misuse PROMISE_MISUSE_RAW=82 node --import ./hooks.mjs test.mjs
```

## Stability

This is pre-alpha software intended to be used for debugging and internal tools. It relies on timing and internal details of how Promises are queued by v8 for Node's `async_hooks` module.

### Known issues

Between 2 awaits the first await will be considered unwrapped many times over by the Promises queued between it and the next await. This is a fairly simple fix but requires some work that hasn't been done yet around separating how we determine if a Promise execution context when becoming `evaluated` should or should not be considered to unwrap the execution context it was first triggered in.
