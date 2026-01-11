#!/usr/bin/env node
/**
 * Generate latest.json for Tauri auto-updater and landing page
 * 
 * Usage: node scripts/generate-latest-json.js v0.2.2
 * 
 * Outputs:
 * - dist-updater/latest.json (for Tauri auto-updater)
 * - dist-updater/downloads.json (for landing page)
 */

const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node generate-latest-json.js <version>');
  process.exit(1);
}

const cleanVersion = version.replace(/^v/, '');
const repo = process.env.GITHUB_REPOSITORY || 'Fluxloop-AI/pluto-duck-oss';
const baseUrl = `https://github.com/${repo}/releases/download/${version}`;
const releasePageUrl = `https://github.com/${repo}/releases/tag/${version}`;

const artifactsDir = process.env.ARTIFACTS_DIR || 'artifacts';

// Recursively find all files in directory
function getAllFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllFiles(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

// Find files matching patterns (recursively)
function findFile(pattern, requiredSubstr = null) {
  if (!fs.existsSync(artifactsDir)) {
    console.error(`Artifacts directory not found: ${artifactsDir}`);
    return null;
  }
  
  const allFiles = getAllFiles(artifactsDir);
  const match = allFiles.find((f) => {
    if (!f.includes(pattern)) return false;
    if (requiredSubstr && !f.includes(requiredSubstr)) return false;
    return true;
  });
  return match || null;
}

// Read signature from .sig file
function readSignature(sigPath) {
  if (!sigPath || !fs.existsSync(sigPath)) {
    console.error(`Signature file not found: ${sigPath}`);
    return '';
  }
  return fs.readFileSync(sigPath, 'utf-8').trim();
}

// Get file size in MB
function getFileSizeMB(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stats = fs.statSync(filePath);
  return Math.round(stats.size / (1024 * 1024));
}

// Find artifact files - prefer per-arch artifact folders (avoids collisions when filenames are identical)
const aarch64TarGz =
  findFile('.app.tar.gz', 'tauri-aarch64') ||
  findFile('aarch64.app.tar.gz') ||
  findFile('_aarch64.app.tar.gz');
const aarch64Sig =
  findFile('.app.tar.gz.sig', 'tauri-aarch64') ||
  findFile('aarch64.app.tar.gz.sig') ||
  findFile('_aarch64.app.tar.gz.sig');

const x64TarGz =
  findFile('.app.tar.gz', 'tauri-x86_64') ||
  findFile('x64.app.tar.gz') ||
  findFile('_x64.app.tar.gz');
const x64Sig =
  findFile('.app.tar.gz.sig', 'tauri-x86_64') ||
  findFile('x64.app.tar.gz.sig') ||
  findFile('_x64.app.tar.gz.sig');

const aarch64Dmg = findFile('.dmg', 'tauri-aarch64') || findFile('aarch64.dmg') || findFile('_aarch64.dmg');
const x64Dmg = findFile('.dmg', 'tauri-x86_64') || findFile('x64.dmg') || findFile('_x64.dmg');

// Fallback: find any .app.tar.gz if specific ones not found
const genericTarGz = findFile('.app.tar.gz');
const genericSig = findFile('.app.tar.gz.sig');

console.log('Found artifacts:');
console.log('  aarch64 tar.gz:', aarch64TarGz);
console.log('  aarch64 sig:', aarch64Sig);
console.log('  aarch64 dmg:', aarch64Dmg);
console.log('  x64 tar.gz:', x64TarGz);
console.log('  x64 sig:', x64Sig);
console.log('  x64 dmg:', x64Dmg);
console.log('  generic tar.gz:', genericTarGz);
console.log('  generic sig:', genericSig);

// Build platforms object for Tauri updater
const platforms = {};

if (aarch64TarGz) {
  const filename = path.basename(aarch64TarGz);
  const sig = aarch64Sig ? readSignature(aarch64Sig) : '';
  platforms['darwin-aarch64'] = {
    signature: sig,
    url: `${baseUrl}/${encodeURIComponent(filename)}`,
  };
  if (!sig) console.warn('Warning: No signature for aarch64');
}

if (x64TarGz) {
  const filename = path.basename(x64TarGz);
  const sig = x64Sig ? readSignature(x64Sig) : '';
  platforms['darwin-x86_64'] = {
    signature: sig,
    url: `${baseUrl}/${encodeURIComponent(filename)}`,
  };
  if (!sig) console.warn('Warning: No signature for x64');
}

// Fallback to generic if no architecture-specific found
if (Object.keys(platforms).length === 0 && genericTarGz) {
  const filename = path.basename(genericTarGz);
  const sig = genericSig ? readSignature(genericSig) : '';
  // Use generic for both platforms
  platforms['darwin-aarch64'] = {
    signature: sig,
    url: `${baseUrl}/${encodeURIComponent(filename)}`,
  };
  platforms['darwin-x86_64'] = {
    signature: sig,
    url: `${baseUrl}/${encodeURIComponent(filename)}`,
  };
  console.log('Using generic tar.gz for both platforms');
}

if (Object.keys(platforms).length === 0) {
  console.error('No valid platform artifacts found!');
  process.exit(1);
}

// Tauri updater manifest (latest.json)
const manifest = {
  version: cleanVersion,
  notes: `See ${releasePageUrl}`,
  pub_date: new Date().toISOString(),
  platforms,
};

// Landing page downloads manifest (downloads.json)
// Use found DMGs or fallback to generic
const appleSiliconDmg = aarch64Dmg;
const intelDmg = x64Dmg;
const appleSiliconTarGz = aarch64TarGz || genericTarGz;
const intelTarGz = x64TarGz || genericTarGz;

const downloads = {
  version: cleanVersion,
  releaseDate: new Date().toISOString().split('T')[0],
  releaseUrl: releasePageUrl,
  macOS: {
    appleSilicon: {
      dmg: appleSiliconDmg ? {
        url: `${baseUrl}/${encodeURIComponent(path.basename(appleSiliconDmg))}`,
        size: getFileSizeMB(appleSiliconDmg),
        filename: path.basename(appleSiliconDmg),
      } : null,
      tarGz: appleSiliconTarGz ? {
        url: `${baseUrl}/${encodeURIComponent(path.basename(appleSiliconTarGz))}`,
        size: getFileSizeMB(appleSiliconTarGz),
        filename: path.basename(appleSiliconTarGz),
      } : null,
    },
    intel: {
      dmg: intelDmg ? {
        url: `${baseUrl}/${encodeURIComponent(path.basename(intelDmg))}`,
        size: getFileSizeMB(intelDmg),
        filename: path.basename(intelDmg),
      } : null,
      tarGz: intelTarGz ? {
        url: `${baseUrl}/${encodeURIComponent(path.basename(intelTarGz))}`,
        size: getFileSizeMB(intelTarGz),
        filename: path.basename(intelTarGz),
      } : null,
    },
  },
};

// Write output files
const outputDir = 'dist-updater';
fs.mkdirSync(outputDir, { recursive: true });

// latest.json for Tauri updater
const latestPath = path.join(outputDir, 'latest.json');
fs.writeFileSync(latestPath, JSON.stringify(manifest, null, 2));

// downloads.json for landing page
const downloadsPath = path.join(outputDir, 'downloads.json');
fs.writeFileSync(downloadsPath, JSON.stringify(downloads, null, 2));

console.log(`\nGenerated ${latestPath}:`);
console.log(JSON.stringify(manifest, null, 2));

console.log(`\nGenerated ${downloadsPath}:`);
console.log(JSON.stringify(downloads, null, 2));
