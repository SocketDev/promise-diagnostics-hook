# Promise Diagnostics Hook

## Usage

This is a module intended to produce dumps when preloaded using `--import`.

It can configure where the dump is saved using the `PROMISE_DIAGNOSTICS_HOOK_LOG` environment variable:

```sh filename=collect.sh
PROMISE_DIAGNOSTICS_HOOK_LOG="async_hooks.log" node --import "@socketsecurity/promise-diagnostics-hook/register" app.mjs
```

This will dump all the information about async hooks invocations into the log file specified. If no log file is specified one will be allocated like: `$DATE.$PROCESS_ID.$THREAD_ID.async_hooks.ndjson`.

In order to understand the logs you can use the reporter:

```sh filename=diagnose.sh
npx @ssocketsecurity/promise-debug-hook/analyze "${PROMISE_DIAGNOSTICS_HOOK_LOG}"
```

## Stability

This is pre-alpha software intended to be used for debugging and internal tools. It relies on timing and internal details of how Promises are queued by v8 for Node's `async_hooks` module.

### Known issues

Between 2 awaits the first await will be considered unwrapped many times over by the Promises queued between it and the next await. This is a fairly simple fix but requires some work that hasn't been done yet around separating how we determine if a Promise execution context when becoming `evaluated` should or should not be considered to unwrap the execution context it was first triggered in.
