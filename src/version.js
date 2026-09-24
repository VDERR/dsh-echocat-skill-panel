/**
 * The one place the HOST half's version is written.
 *
 * It used to be a literal in `index.js` only, which was fine while the host half was the only
 * thing that needed it (route payloads, the `X-` header the verifier reads, the provenance
 * record). The release check needs it too, and the client bundle cannot import a host module —
 * so a leaf module with no imports of its own keeps the host half and the tests reading the
 * same string.
 *
 * NOTE: `src/client/theme.js` necessarily carries its OWN copy, because the browser half is a
 * separate bundle with its own module table and no access to `src/`. That is the drift this
 * file's comment warns about, and `test/release.mjs` now asserts all three agree
 * (`package.json`, this file, `src/client/theme.js`) — the client copy was unchecked until
 * 4.0.1 and had already gone stale once by the time anyone looked.
 */
export const VERSION = '5.1.2'
