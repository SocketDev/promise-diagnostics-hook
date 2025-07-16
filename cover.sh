_NODE_OPTIONS="${NODE_OPTIONS}"
export NODE_OPTIONS="${NODE_OPTIONS} --import=${PWD}/hooks.mts"
export PROMISE_DIAGNOSTICS_HOOK_LOG="${PWD}/async_hooks.log"

# Run the provided command first
"$@"

# Then run the text-reporter
export NODE_OPTIONS="${_NODE_OPTIONS}"
node ./analyze.mts "${PROMISE_DIAGNOSTICS_HOOK_LOG}"
