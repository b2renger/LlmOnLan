// @ts-check
// The path table both scratch-projects backends must agree on (studio plan §3.8.2).
//
// It is a FIXTURE, not a test: projects-path.test.mjs runs it against the compiled main-process
// validator (shell/build/main/projectsPath.js) and projects-bridge.test.mjs runs it against the
// renderer's memory backend. If the two ever drift, one of those two files goes red — which is the
// whole reason the memory backend re-implements the rules instead of guessing.

const B = String.fromCharCode(92);       // a backslash, written once so no escape can hide it
const NUL = String.fromCharCode(0);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const DEL = String.fromCharCode(127);

/** @type {{rel: string, code: 'E_PATH'|'E_EXT', why: string}[]} */
export const REJECTED = [
  // 1. empty / too long / control characters
  { rel: '', code: 'E_PATH', why: 'empty' },
  { rel: 'a'.repeat(198) + '.js', code: 'E_PATH', why: '201 characters' },
  { rel: 'a' + NUL + '.js', code: 'E_PATH', why: 'NUL byte' },
  { rel: 'a' + CR + '.js', code: 'E_PATH', why: 'carriage return' },
  { rel: 'a' + LF + '.js', code: 'E_PATH', why: 'line feed' },
  { rel: 'a' + TAB + '.js', code: 'E_PATH', why: 'tab' },
  { rel: 'a' + DEL + '.js', code: 'E_PATH', why: 'DEL' },

  // 2. backslashes — the renderer speaks '/' only
  { rel: 'a' + B + 'b.js', code: 'E_PATH', why: 'windows separator' },
  { rel: B + 'abs.js', code: 'E_PATH', why: 'leading backslash' },
  { rel: B + B + 'unc' + B + 'x.js', code: 'E_PATH', why: 'UNC with backslashes' },
  { rel: 'C:' + B + 'x.js', code: 'E_PATH', why: 'drive letter with backslash' },
  { rel: 'lib' + B + '..' + B + 'x.js', code: 'E_PATH', why: 'backslash traversal' },

  // 3. absolute / drive / UNC in POSIX spelling
  { rel: '/abs.js', code: 'E_PATH', why: 'absolute' },
  { rel: '//unc/x.js', code: 'E_PATH', why: 'UNC' },
  { rel: 'C:/x.js', code: 'E_PATH', why: 'drive letter' },
  { rel: 'c:x.js', code: 'E_PATH', why: 'drive-relative' },

  // 4. traversal
  { rel: '..', code: 'E_PATH', why: 'dot dot' },
  { rel: '../..', code: 'E_PATH', why: 'dot dot twice' },
  { rel: '../x.js', code: 'E_PATH', why: 'escape one level' },
  { rel: 'a/../../b.js', code: 'E_PATH', why: 'escape through a segment' },
  { rel: './x.js', code: 'E_PATH', why: 'dot segment' },
  { rel: 'a/./b.js', code: 'E_PATH', why: 'dot segment inside' },
  { rel: 'a/..', code: 'E_PATH', why: 'trailing dot dot' },
  { rel: 'a//b.js', code: 'E_PATH', why: 'empty segment' },
  { rel: 'lib/', code: 'E_PATH', why: 'trailing slash' },

  // 5. depth and segment length
  { rel: 'a/b/c/d/e.js', code: 'E_PATH', why: '5 deep' },
  { rel: 'a/b/c/d/e/f.js', code: 'E_PATH', why: '6 deep' },
  { rel: 'x'.repeat(65) + '.js', code: 'E_PATH', why: '69-char segment' },
  { rel: 'lib/' + 'y'.repeat(65) + '.js', code: 'E_PATH', why: 'long segment in a subfolder' },

  // 6. NTFS streams, illegal characters, trailing dot or space
  { rel: 'a:b.js', code: 'E_PATH', why: 'alternate data stream' },
  { rel: 'x.js:Zone.Identifier', code: 'E_PATH', why: 'named stream' },
  { rel: 'a*b.js', code: 'E_PATH', why: 'star' },
  { rel: 'a?b.js', code: 'E_PATH', why: 'question mark' },
  { rel: 'a"b.js', code: 'E_PATH', why: 'quote' },
  { rel: 'a<b.js', code: 'E_PATH', why: 'less than' },
  { rel: 'a>b.js', code: 'E_PATH', why: 'greater than' },
  { rel: 'a|b.js', code: 'E_PATH', why: 'pipe' },
  { rel: 'dir./x.js', code: 'E_PATH', why: 'segment ends with a dot' },
  { rel: 'dir /x.js', code: 'E_PATH', why: 'segment ends with a space' },
  { rel: 'sketch.js ', code: 'E_PATH', why: 'file name ends with a space' },
  { rel: 'a .', code: 'E_PATH', why: 'space then dot' },

  // 7. Windows reserved device names, extension or not
  { rel: 'con', code: 'E_PATH', why: 'CON' },
  { rel: 'CON.txt', code: 'E_PATH', why: 'CON with an extension' },
  { rel: 'nul.ino', code: 'E_PATH', why: 'NUL' },
  { rel: 'com1/x.js', code: 'E_PATH', why: 'COM1 as a folder' },
  { rel: 'LPT9.h', code: 'E_PATH', why: 'LPT9' },
  { rel: 'aux.md', code: 'E_PATH', why: 'AUX' },
  { rel: 'prn.txt', code: 'E_PATH', why: 'PRN' },
  { rel: 'com0.js', code: 'E_PATH', why: 'COM0' },
  { rel: 'lpt0.md', code: 'E_PATH', why: 'LPT0' },
  { rel: 'lib/CoN.css', code: 'E_PATH', why: 'CON, mixed case, nested' },

  // 8. dotfiles and .git
  { rel: '.git/config', code: 'E_PATH', why: '.git' },
  { rel: '.git/HEAD', code: 'E_PATH', why: '.git again' },
  { rel: '.env', code: 'E_PATH', why: 'dotfile' },
  { rel: '.npmrc', code: 'E_PATH', why: 'another dotfile' },
  { rel: 'lib/.git/config', code: 'E_PATH', why: 'a nested .git' },
  { rel: '.gitignore.js', code: 'E_PATH', why: 'a dot name that is not .gitignore' },

  // 9. extensions
  { rel: 'x.exe', code: 'E_EXT', why: 'executable' },
  { rel: 'x.bat', code: 'E_EXT', why: 'batch file' },
  { rel: 'x.ps1', code: 'E_EXT', why: 'powershell' },
  { rel: 'x.lnk', code: 'E_EXT', why: 'shortcut' },
  { rel: 'x.sh', code: 'E_EXT', why: 'shell script' },
  { rel: 'x.dll', code: 'E_EXT', why: 'library' },
  { rel: 'x.scr', code: 'E_EXT', why: 'screensaver' },
  { rel: 'sketch', code: 'E_EXT', why: 'no extension' },
  { rel: 'lib/readme', code: 'E_EXT', why: 'no extension, nested' },
];

/** @type {{rel: string, kind: 'text'|'bin', why: string}[]} */
export const ACCEPTED = [
  { rel: 'sketch.js', kind: 'text', why: 'the sketch itself' },
  { rel: 'index.html', kind: 'text', why: 'a page' },
  { rel: 'style.css', kind: 'text', why: 'a stylesheet' },
  { rel: 'lib/p5.js', kind: 'text', why: "the project's own p5" },
  { rel: 'src/main.cpp', kind: 'text', why: 'firmware' },
  { rel: 'src/pins.h', kind: 'text', why: 'a header' },
  { rel: 'blink.ino', kind: 'text', why: 'an Arduino sketch' },
  { rel: 'notes/BRIEF.md', kind: 'text', why: 'the brief' },
  { rel: 'shader.frag', kind: 'text', why: 'a fragment shader' },
  { rel: 'data/points.csv', kind: 'text', why: 'data' },
  { rel: '.gitignore', kind: 'text', why: 'the one allowed dot name' },
  { rel: 'a/b/c/d.js', kind: 'text', why: 'exactly four deep' },
  { rel: 'z'.repeat(60) + '.js', kind: 'text', why: 'a 63-char segment' },
  { rel: 'assets/img/a.png', kind: 'bin', why: 'an image' },
  { rel: 'assets/snap.jpeg', kind: 'bin', why: 'a photo' },
  { rel: 'audio/loop.wav', kind: 'bin', why: 'a sample' },
  { rel: 'fonts/Inter.woff2', kind: 'bin', why: 'a font' },
];

/** Paths that are fine for one call and refused by the other (the TEXT/BIN split). */
export const WRONG_LIST = [
  { rel: 'assets/img/a.png', call: 'text', code: 'E_EXT', why: 'an image is not text' },
  { rel: 'sketch.js', call: 'bin', code: 'E_EXT', why: 'a script is not binary' },
];
