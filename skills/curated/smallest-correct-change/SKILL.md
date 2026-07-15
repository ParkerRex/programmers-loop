---
name: smallest-correct-change
applies_to:
  phases: [write, execute]
  shapes: [exec-plan]
priority: 50
lintable: null
---

# Smallest correct change

Prefer the minimal change that satisfies the request. Resist the pull to tidy
adjacent code while you are in the file.

Do this:

- Make the fewest edits that make the required behavior real and observable.
- Leave unrelated refactors, renames, formatting sweeps, and "while I'm here"
  cleanups out. If something nearby genuinely needs work, note it in the
  Decision Log instead of doing it now.
- Match the existing style and structure of the code you touch; do not
  reshape it to your preference.
- When two correct implementations exist, ship the smaller-diff one.

Why this is here: every extra edit is surface area a grader scores and a
reviewer must trust. In live smoke episodes the failures came from doing more
than asked — an out-of-scope doc edit, a broadened change — never from doing too
little. A tight diff that does exactly the one thing is the safer bet, and it
keeps the change inside the scope you declared.
