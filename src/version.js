/**
 * The one place the plugin's version is written.
 *
 * It used to be a literal in `index.js` only, which was fine while the host half was the
 * only thing that needed it (route payloads, the `X-` header the verifier reads, the
 * provenance record). The release check needs it too, and the client bundle cannot import
 * a host module — so a leaf module with no imports of its own keeps both halves, and the
 * tests, reading the same string. A second copy is how a panel ends up claiming version
 * 4.0.0 while the process runs 4.0.1.
 */
export const VERSION = '4.0.0'
