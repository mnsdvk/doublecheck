# Friction log

## Entry 1: Kiro Crew type-check

* Task: improve an existing project with Kiro Crew.
* Steps: uploaded the repo, asked it to inspect the engine and tests and make one meaningful improvement.
* Expected: Kiro should make the requested change without introducing new failures.
* Actual: the change worked and the tests passed, but `npm run typecheck` reported 3 errors that were already in the project before the change.
* Severity: Medium.
* Workaround: separated the existing errors from the new change by comparing the affected lines.
* Suggestion: show the starting type-check and test state before making changes, so existing failures are not confused with new ones.

## Entry 2: Verifying a hand-written MCP server

* Task: confirm a hand-written MCP server follows the spec.
* Steps: wrote the server by hand over Streamable HTTP and looked for a way to check it against the spec.
* Expected: an easy conformance check.
* Actual: I did not run the official Inspector, so I could not independently claim full specification conformance. I wrote my own protocol tests instead.
* Severity: Low.
* Workaround: automated tests that call the server over real HTTP.
* Suggestion: publish a small conformance test suite for server authors.