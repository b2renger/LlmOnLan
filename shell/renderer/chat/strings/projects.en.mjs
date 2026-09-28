// @ts-check
// Strings for the scratch-projects bridge (studio plan §3.8). The panels that show projects arrive
// in S2/S3; what lives here is what the BRIDGE itself has to say — the one honest sentence when
// this build has no projects folder, and a plain sentence per error code so no surface ever has to
// print a raw E_* at a person. (The Reveal / Copy path / Forget labels were never used and are gone.)
import { registerStrings } from '../core/i18n.mjs';

registerStrings('projects', {
  // degradation (bridge.mjs: window.lol.projects is absent — an older shell, or the harness): the bridge keeps
  // projects in memory only. Pinned verbatim by projects-bridge.test and s0-projects-memory.
  memoryNotice: 'this build has no projects folder; sketches run but are not saved',

  // one sentence per error code — err_<CODE>, because i18n keys are [A-Za-z0-9_.]
  err_E_ROOT: 'The projects folder could not be used.',
  err_E_ID: 'That project could not be found.',
  err_E_PATH: 'That file name is not allowed here.',
  err_E_EXT: 'That kind of file cannot be saved here.',
  err_E_SIZE: 'That file is too big for a scratch project.',
  err_E_QUOTA: 'This project has reached its limit.',
  err_E_RATE: 'Too many saves at once — try again in a moment.',
  err_E_MISSING: 'That file or folder is not there any more.',
  err_E_LOCKED: 'The file is open in another program.',
  err_E_CONFLICT: 'The file changed on disk — reload it before saving.',
  err_E_IO: 'The file could not be saved.',
  err_unknown: 'Something went wrong with the projects folder.',
});
