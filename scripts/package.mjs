#!/usr/bin/env node
// Per-browser packaging for OpenLeaf.
//
//   node scripts/package.mjs chromium        → zip for Chrome / Opera / Edge
//   node scripts/package.mjs safari          → Xcode project via Apple's converter
//   node scripts/package.mjs chromium safari → both
//
// Run `npm run build` first (the npm `package:*` scripts do this for you).
// A package contains only what the store needs: manifest.json + dist/ + public/.

import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = join(ROOT, 'build')
const ARTIFACTS_DIR = join(ROOT, 'web-ext-artifacts')
const SAFARI_DIR = join(ROOT, 'safari')

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'))
const VERSION = manifest.version

// Files the manifest references at runtime. Everything else (src/, configs,
// node_modules, committed zips) stays out of the shipped package.
const PACKAGE_CONTENTS = ['manifest.json', 'dist', 'public']
// dist/ artifacts that must exist for a package to be valid.
const REQUIRED_DIST = [
  'background.js',
  'content.js',
  'options.js',
  'page-bridge.js',
  'content.css',
]

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

function assertBuilt() {
  const dist = join(ROOT, 'dist')
  if (!existsSync(dist)) fail("No dist/ found. Run `npm run build` first.")
  const missing = REQUIRED_DIST.filter(f => !existsSync(join(dist, f)))
  if (missing.length) {
    fail(`dist/ is incomplete (missing: ${missing.join(', ')}). Run \`npm run build\`.`)
  }
}

// Copy the manifest + assets into a clean staging directory, skipping junk.
function assembleStaging(stageDir) {
  rmSync(stageDir, { recursive: true, force: true })
  mkdirSync(stageDir, { recursive: true })
  for (const entry of PACKAGE_CONTENTS) {
    cpSync(join(ROOT, entry), join(stageDir, entry), {
      recursive: true,
      filter: src => !src.endsWith('.DS_Store'),
    })
  }
}

function which(cmd) {
  try {
    execFileSync('command', ['-v', cmd], { stdio: 'pipe', shell: true })
    return true
  } catch {
    return false
  }
}

function packageChromium() {
  const stageDir = join(BUILD_DIR, 'chromium')
  assembleStaging(stageDir)

  if (!which('zip')) {
    fail("`zip` is not installed. Install it, or zip build/chromium/ manually.")
  }

  mkdirSync(ARTIFACTS_DIR, { recursive: true })
  const zipPath = join(ARTIFACTS_DIR, `openleaf-chromium-v${VERSION}.zip`)
  rmSync(zipPath, { force: true })
  execFileSync('zip', ['-r', '-X', zipPath, '.', '-x', '*.DS_Store'], {
    cwd: stageDir,
    stdio: 'inherit',
  })

  console.log(`\n✓ Chromium package → ${zipPath}`)
  console.log('  Loads in Chrome, Opera, and Edge (Developer mode → Load unpacked,')
  console.log('  or upload the zip to the respective store).')
}

function packageSafari() {
  const stageDir = join(BUILD_DIR, 'safari-src')
  assembleStaging(stageDir)

  // The converter ships with full Xcode, not the Command Line Tools.
  try {
    execFileSync('xcrun', ['--find', 'safari-web-extension-converter'], {
      stdio: 'pipe',
    })
  } catch {
    fail(
      'safari-web-extension-converter not found.\n' +
        '  It ships with the full Xcode app (not the Command Line Tools).\n' +
        '  1. Install Xcode from the App Store.\n' +
        '  2. sudo xcode-select -s /Applications/Xcode.app/Contents/Developer\n' +
        '  3. Re-run `npm run package:safari`.\n' +
        `  The Safari-ready extension is staged at: ${stageDir}`
    )
  }

  rmSync(SAFARI_DIR, { recursive: true, force: true })
  mkdirSync(SAFARI_DIR, { recursive: true })
  execFileSync(
    'xcrun',
    [
      'safari-web-extension-converter',
      stageDir,
      '--project-location', SAFARI_DIR,
      '--app-name', 'OpenLeaf',
      '--bundle-identifier', 'com.openleaf.extension',
      '--no-open',
      '--no-prompt',
      '--force',
    ],
    { stdio: 'inherit' }
  )

  console.log(`\n✓ Safari Xcode project → ${SAFARI_DIR}`)
  console.log('  Open it in Xcode, then Product → Run to install into Safari.')
  console.log('  Enable it under Safari → Settings → Extensions (turn on')
  console.log('  "Allow unsigned extensions" in the Develop menu for local runs).')
}

const TARGETS = { chromium: packageChromium, safari: packageSafari }

const requested = process.argv.slice(2)
if (!requested.length) {
  fail(`Usage: node scripts/package.mjs <${Object.keys(TARGETS).join('|')}> [...]`)
}
const unknown = requested.filter(t => !TARGETS[t])
if (unknown.length) fail(`Unknown target(s): ${unknown.join(', ')}`)

assertBuilt()
for (const target of requested) TARGETS[target]()
