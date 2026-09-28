// @ts-check
// The Fetch box (docs/ECOSYSTEM_PLAN.md v2 §4.2). One file per unit, same namespace: see
// strings/parts-text.en.mjs for why.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  fetchLabel: 'Fetch',
  fetchUrl: 'Address',
  fetchUrlPlaceholder: 'https://… (an open API or page, no key)',
  fetchUrlHint: 'The web address to read (an open API or a page that needs no key). Each run reads it again; if the network is gone, the box keeps the last copy it read. Only this address is asked — nothing from the graph is sent.',
  fetchStatus: '{status} · {kb} KB · {host}',
  fetchOffline: 'Offline — kept the last copy: {message}',
  fetchNoUrl: 'Write a web address first.',
  fetchNoDoor: 'This version of the app cannot fetch from the web — update LlmOnLan.',
  fetchErr_E_URL: 'That is not a web address.',
  fetchErr_E_SCHEME: 'Only http:// and https:// addresses can be fetched.',
  fetchErr_E_CREDENTIALS: 'The address carries a user name or password. A graph never holds credentials — use an open address.',
  fetchErr_E_FARM: 'That is one of the farm’s own addresses, and Fetch does not read the farm. The boxes that use the farm (Instruction, Classify, Listen on a Sound box…) reach it by themselves.',
  fetchErr_E_LOCAL: 'That address points at this computer itself (localhost, 127.0.0.1…) or at a 169.254 address. Fetch reads the web and your network, not this computer.',
  fetchErr_E_DNS: 'The name “{message}” could not be found. Check the address, or the network.',
  fetchErr_E_TIMEOUT: 'The address did not answer within 15 seconds.',
  fetchErr_E_SIZE: 'The answer is bigger than 1 MB, the most a box can hold. Ask the source for less (fewer items, a smaller page).',
  fetchErr_E_TYPE: 'The answer is not text ({message}). Use the Image or Document box for pictures and PDFs.',
  fetchErr_E_HTTP: 'The address answered {status}.',
  fetchSaid: 'It said: “{detail}”',
  fetchErr_E_REDIRECTS: 'The address redirected too many times.',
  fetchErr_E_NET: 'The address could not be reached: {message}',
  fetchErr_E_HOST: 'That leads to {message}, which is not one of the hosts this box may read (a redirect is checked too).',
});
