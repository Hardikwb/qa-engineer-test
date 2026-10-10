# Submission Summary

I read every route and the in-memory database, then started the real API and reproduced each of the 7 bugs over HTTP before touching any code.
While doing so I found one extra defect: the seeded merchant's bcrypt hash was invalid, so the documented login returned 401.
All 7 bugs (A-G) and the seed hash are fixed with small, commented changes that keep the existing API contracts and only add 400, 401 and 409 responses.
I wrote 30 end-to-end tests with the Node built-in runner that start the real server and cover every bug, and all pass with `npm test`.
Details are in `bug-reports.md`, `fixes.md` and `test-plan.md`.
