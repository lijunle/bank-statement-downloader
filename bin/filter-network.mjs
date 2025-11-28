#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);

if (args.length < 2) {
    console.error('Usage: node filter-network.mjs <domain> <network-file> [output-file]');
    console.error('Example: node filter-network.mjs bmo.com trace-123456.network filtered.network');
    process.exit(1);
}

const domain = args[0];
const inputFile = args[1];
const outputFile = args[2] || inputFile.replace(/\.network$/, '.filtered.network');

console.log(`Filtering network trace: ${inputFile}`);
console.log(`Domain: ${domain}`);

// Static resource extensions to filter out
const staticExtensions = [
    'css', 'js', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp',
    'woff', 'woff2', 'ttf', 'eot', 'ico'
];

const extensionPattern = new RegExp(`\\.(${staticExtensions.join('|')})(\\?|$)`, 'i');

// Static resource MIME types to filter out
const staticMimeTypes = [
    'text/css',
    'text/javascript', 'application/javascript', 'application/x-javascript',
    'image/png', 'image/jpg', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp', 'image/x-icon',
    'font/woff', 'font/woff2', 'font/ttf', 'font/eot', 'font/otf', 'application/font-woff', 'application/font-woff2'
];

const mimeTypePattern = new RegExp(`^(${staticMimeTypes.map(mt => mt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');

// Escape special regex characters in domain
const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Create regex that matches the domain with optional subdomain
const domainPattern = new RegExp(`^https?://([^/]*\\.)?${escapedDomain}/`, 'i');

let inputLines;
try {
    const content = readFileSync(inputFile, 'utf8');
    inputLines = content.split('\n').filter(line => line.trim());
} catch (error) {
    console.error(`Error reading input file: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

const filteredLines = [];
let skippedCount = 0;

for (const line of inputLines) {
    if (!line.trim()) continue;

    try {
        const entry = JSON.parse(line);
        const url = entry.snapshot?.request?.url;
        const mimeType = entry.snapshot?.response?.content?.mimeType;

        if (!url) {
            skippedCount++;
            continue;
        }

        // Check if URL is a static resource by extension (skip early, regardless of domain)
        if (extensionPattern.test(url)) {
            skippedCount++;
            continue;
        }

        // Check if response is a static resource by MIME type (skip early, regardless of domain)
        if (mimeType && mimeTypePattern.test(mimeType)) {
            skippedCount++;
            continue;
        }

        // Check if URL matches the domain pattern
        if (!domainPattern.test(url)) {
            skippedCount++;
            continue;
        }

        filteredLines.push(line);
    } catch (error) {
        console.error(`Error parsing line: ${error instanceof Error ? error.message : String(error)}`);
        skippedCount++;
    }
}

// Write output
try {
    writeFileSync(outputFile, filteredLines.join('\n') + '\n', 'utf8');
    console.log(`Filtered ${filteredLines.length} requests (skipped ${skippedCount})`);
    console.log(`Output written to: ${outputFile}`);
} catch (error) {
    console.error(`Error writing output file: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
