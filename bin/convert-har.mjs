#!/usr/bin/env node

/**
 * Convert Playwright network trace (JSONL) to HAR format
 * 
 * Usage: node convert-har.mjs <input.network> [output.har]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

/**
 * Check if a MIME type is text-based
 * @param {string | undefined} mimeType - The MIME type to check
 * @returns {boolean} True if the MIME type is text-based
 */
function isTextMimeType(mimeType) {
    if (!mimeType) return false;

    const textTypes = [
        'text/',
        'application/json',
        'application/javascript',
        'application/xml',
        'application/x-www-form-urlencoded',
        'application/xhtml+xml',
        'image/svg+xml'
    ];

    return textTypes.some(type => mimeType.includes(type));
}

/**
 * Read a resource file from the traces directory
 * @param {string} tracesDir - The traces directory path
 * @param {string} sha1Ref - The SHA1 reference filename
 * @returns {Buffer | null} The file content as a Buffer, or null if not found
 */
function readResourceFile(tracesDir, sha1Ref) {
    const resourcePath = path.join(tracesDir, 'resources', sha1Ref);

    if (!fs.existsSync(resourcePath)) {
        console.warn(`Warning: Resource file not found: ${sha1Ref}`);
        return null;
    }

    try {
        return fs.readFileSync(resourcePath);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Warning: Failed to read resource file ${sha1Ref}:`, message);
        return null;
    }
}

/**
 * Process a network trace entry and resolve _sha1 references
 * @param {any} entry - The network trace entry
 * @param {string} tracesDir - The traces directory path
 * @returns {any} The processed HAR entry, or null if not a resource-snapshot
 */
function processEntry(entry, tracesDir) {
    if (entry.type !== 'resource-snapshot') {
        return null;
    }

    const snapshot = entry.snapshot;

    // Process request body if it has a _sha1 reference
    if (snapshot.request?.postData?._sha1) {
        const sha1 = snapshot.request.postData._sha1;
        const content = readResourceFile(tracesDir, sha1);

        if (content) {
            const mimeType = snapshot.request.postData.mimeType || '';

            if (isTextMimeType(mimeType)) {
                snapshot.request.postData.text = content.toString('utf8');
            } else {
                snapshot.request.postData.text = content.toString('base64');
                snapshot.request.postData.encoding = 'base64';
            }
        }

        delete snapshot.request.postData._sha1;
    }

    // Process response body if it has a _sha1 reference
    if (snapshot.response?.content?._sha1) {
        const sha1 = snapshot.response.content._sha1;
        const content = readResourceFile(tracesDir, sha1);

        if (content) {
            const mimeType = snapshot.response.content.mimeType || '';

            if (isTextMimeType(mimeType)) {
                snapshot.response.content.text = content.toString('utf8');
            } else {
                snapshot.response.content.text = content.toString('base64');
                snapshot.response.content.encoding = 'base64';
            }
        }

        delete snapshot.response.content._sha1;
    }

    return snapshot;
}

/**
 * Convert a Playwright network trace file to HAR format
 * @param {string} inputFile - The input network trace file path
 * @param {string} [outputFile] - Optional output file path. If not specified, uses input path with .har extension
 */
export function convertNetworkToHar(inputFile, outputFile) {
    const inputPath = path.resolve(inputFile);
    const tracesDir = path.join(path.dirname(inputPath), '../.playwright-mcp/traces');

    if (!fs.existsSync(inputFile)) {
        console.error(`Error: Input file not found: ${inputFile}`);
        process.exit(1);
    }

    // Generate output file path with .har extension if not provided
    if (!outputFile) {
        outputFile = inputFile.replace(/\.[^.]*$/, '.har');
    }

    console.log(`Reading network trace: ${inputFile}`);

    // Try to detect encoding by reading first few bytes
    const buffer = fs.readFileSync(inputPath);
    let content;

    // Check for UTF-16 LE BOM (FF FE)
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
        content = buffer.toString('utf16le');
    } else {
        content = buffer.toString('utf8');
    }

    const lines = content.trim().split('\n');

    console.log(`Processing ${lines.length} entries...`);

    const entries = [];
    for (const line of lines) {
        if (!line.trim()) continue;

        try {
            const entry = JSON.parse(line);
            const harEntry = processEntry(entry, tracesDir);

            if (harEntry) {
                entries.push(harEntry);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('Warning: Failed to parse entry:', message);
        }
    }

    const har = {
        log: {
            version: '1.2',
            creator: {
                name: 'Playwright Network Trace Converter',
                version: '1.0.0'
            },
            entries: entries
        }
    };

    const harJson = JSON.stringify(har, null, 2);

    fs.writeFileSync(outputFile, harJson, 'utf8');
    console.log(`HAR file written to: ${outputFile}`);
    console.log(`Total entries: ${entries.length}`);
}

// Main execution - only run when this script is executed directly (not imported)
if (process.argv[1] === __filename) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error('Usage: node convert-har.mjs <input.network> [output.har]');
        console.error('');
        console.error('If output path is not specified, it will be saved as <input>.har in the same folder.');
        console.error('');
        console.error('Examples:');
        console.error('  node convert-har.mjs chase.network');
        console.error('  node convert-har.mjs chase.network output/chase.har');
        process.exit(1);
    }

    const inputFile = args[0];
    const outputFile = args[1];

    convertNetworkToHar(inputFile, outputFile);
}
