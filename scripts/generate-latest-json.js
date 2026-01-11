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

const artifactsDir = 'artifacts';

// Find files matching patterns
function findFile(pattern) {
  if (!fs.existsSync(artifactsDir)) {
    console.error(`Artifacts directory not found: ${artifactsDir}`);
    return null;
  }
  
  const files = fs.readdirSync(artifactsDir);
  const match = files.find(f => f.includes(pattern));
  return match ? path.join(artifactsDir, match) : null;
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

// Find artifact files
const aarch64TarGz = findFile('aarch64.app.tar.gz');
const aarch64Sig = findFile('aarch64.app.tar.gz.sig');
const x64TarGz = findFile('x64.app.tar.gz');
const x64Sig = findFile('x64.app.tar.gz.sig');
const aarch64Dmg = findFile('aarch64.dmg');
const x64Dmg = findFile('x64.dmg');

console.log('Found artifacts:');
console.log('  aarch64 tar.gz:', aarch64TarGz);
console.log('  aarch64 sig:', aarch64Sig);
console.log('  aarch64 dmg:', aarch64Dmg);
console.log('  x64 tar.gz:', x64TarGz);
console.log('  x64 sig:', x64Sig);
console.log('  x64 dmg:', x64Dmg);

// Build platforms object for Tauri updater
const platforms = {};

if (aarch64TarGz && aarch64Sig) {
  const filename = path.basename(aarch64TarGz);
  platforms['darwin-aarch64'] = {
    signature: readSignature(aarch64Sig),
    url: `${baseUrl}/${filename}`,
  };
}

if (x64TarGz && x64Sig) {
  const filename = path.basename(x64TarGz);
  platforms['darwin-x86_64'] = {
    signature: readSignature(x64Sig),
    url: `${baseUrl}/${filename}`,
  };
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
const downloads = {
  version: cleanVersion,
  releaseDate: new Date().toISOString().split('T')[0],
  releaseUrl: releasePageUrl,
  macOS: {
    appleSilicon: {
      dmg: aarch64Dmg ? {
        url: `${baseUrl}/${path.basename(aarch64Dmg)}`,
        size: getFileSizeMB(aarch64Dmg),
        filename: path.basename(aarch64Dmg),
      } : null,
      tarGz: aarch64TarGz ? {
        url: `${baseUrl}/${path.basename(aarch64TarGz)}`,
        size: getFileSizeMB(aarch64TarGz),
        filename: path.basename(aarch64TarGz),
      } : null,
    },
    intel: {
      dmg: x64Dmg ? {
        url: `${baseUrl}/${path.basename(x64Dmg)}`,
        size: getFileSizeMB(x64Dmg),
        filename: path.basename(x64Dmg),
      } : null,
      tarGz: x64TarGz ? {
        url: `${baseUrl}/${path.basename(x64TarGz)}`,
        size: getFileSizeMB(x64TarGz),
        filename: path.basename(x64TarGz),
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
