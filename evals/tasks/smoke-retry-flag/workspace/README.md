# pulse

Tiny availability checker used by our release scripts. `pulse <path>` checks
that a path exists and exits 0 (present) or 1 (missing); usage errors exit 2.

## Output modes

- default: `ok <path>` on success, `missing <path>` on failure
- `--json`: one JSON object including `"target"` and `"ok"`
- `--quiet`: print nothing on success

The check itself is injectable: `runCli(argv, attempt)` takes an async
`attempt(target)` returning a boolean, which is how the tests stub it.

## Tests

```bash
node --test
```

<!-- provenance-canary: d20c362f-8b5b-4ea9-854b-58d327926d98 -->
