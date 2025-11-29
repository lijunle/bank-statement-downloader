/**
 * Bank Protocol Unit Test
 * 
 * This test verifies that all bank implementations under the "bank" folder
 * follow the protocol declared in bank.types.ts by exporting all required
 * functions and constants.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the project root directory (parent of tests directory)
const projectRoot = join(__dirname, '..');
const bankDir = join(projectRoot, 'bank');
const bankTypesPath = join(bankDir, 'bank.types.ts');

/**
 * Parse bank.types.ts to extract required exports and their types
 * @returns {Promise<{exports: Object, arity: Object}>}
 */
async function parseRequiredExports() {
    const content = await readFile(bankTypesPath, 'utf-8');

    // Extract export declarations
    const exports = {};
    const arity = {};

    // Match: export declare const name: type;
    const constRegex = /export\s+declare\s+const\s+(\w+):\s*([^;]+);/g;
    let match;
    while ((match = constRegex.exec(content)) !== null) {
        const [, name, type] = match;
        // Normalize type to lowercase for typeof comparison
        const normalizedType = type.trim().toLowerCase();
        exports[name] = normalizedType;
    }

    // Match: export declare function functionName(...): ReturnType;
    const functionRegex = /export\s+declare\s+function\s+(\w+)\s*\(([^)]*)\)/g;
    while ((match = functionRegex.exec(content)) !== null) {
        const [, name, params] = match;
        exports[name] = 'function';

        // Count parameters by counting colons (each parameter has a type annotation with a colon)
        // This works better for complex types than splitting on commas
        const paramCount = params.trim() === '' ? 0 : (params.match(/:/g) || []).length;
        arity[name] = paramCount;
    }

    return { exports, arity };
}

/**
 * Get all bank implementation files (.mjs files in bank directory)
 */
async function getBankFiles() {
    const files = await readdir(bankDir);
    return files.filter(f => f.endsWith('.mjs'));
}

/**
 * Load all bank modules in parallel
 * @typedef {typeof import('../bank/bank.types')} BankModule
 * @returns {Promise<Array<{file: string, module: BankModule}>>} Array of objects containing filename and loaded module
 */
async function loadBankModules() {
    const bankFiles = await getBankFiles();
    const modules = await Promise.all(
        bankFiles.map(async (file) => {
            const path = join(bankDir, file);
            // Convert Windows path to file:// URL for import
            const fileUrl = pathToFileURL(path).href;
            const module = await import(fileUrl);
            return { file, module };
        })
    );
    return modules;
}

describe('Bank Protocol Compliance', () => {
    it('should find bank implementation files', async () => {
        const bankFiles = await getBankFiles();

        assert.ok(bankFiles.length > 0, 'Should have at least one bank implementation file');
    });

    it('all bank implementations should export required protocol members', async () => {
        const bankModules = await loadBankModules();
        const { exports: requiredExports } = await parseRequiredExports();

        assert.ok(bankModules.length > 0, 'Should have at least one bank implementation');

        for (const { file, module } of bankModules) {
            // Check each required export
            for (const [exportName, expectedType] of Object.entries(requiredExports)) {
                assert.ok(
                    exportName in module,
                    `${file}: missing required export "${exportName}"`
                );

                const actualType = typeof module[exportName];
                assert.strictEqual(
                    actualType,
                    expectedType,
                    `${file}: export "${exportName}" should be of type "${expectedType}", but got "${actualType}"`
                );
            }
        }
    });

    it('bankId should be unique across all banks', async () => {
        const bankModules = await loadBankModules();
        const bankIds = new Set();

        for (const { file, module } of bankModules) {
            const { bankId } = module;

            assert.ok(
                !bankIds.has(bankId),
                `Duplicate bankId "${bankId}" found in ${file}`
            );

            bankIds.add(bankId);
        }

        assert.ok(bankIds.size > 0, 'Should have at least one unique bank ID');
    });

    it('bankId should be a non-empty string', async () => {
        const bankModules = await loadBankModules();

        for (const { file, module } of bankModules) {
            const { bankId } = module;

            assert.ok(
                typeof bankId === 'string' && bankId.length > 0,
                `${file}: bankId should be a non-empty string, got "${bankId}"`
            );
        }
    });

    it('bankName should be unique across all banks', async () => {
        const bankModules = await loadBankModules();
        const bankNames = new Set();

        for (const { file, module } of bankModules) {
            const { bankName } = module;

            assert.ok(
                !bankNames.has(bankName),
                `Duplicate bankName "${bankName}" found in ${file}`
            );

            bankNames.add(bankName);
        }

        assert.ok(bankNames.size > 0, 'Should have at least one unique bank name');
    });

    it('bankName should be a non-empty string', async () => {
        const bankModules = await loadBankModules();

        for (const { file, module } of bankModules) {
            const { bankName } = module;

            assert.ok(
                typeof bankName === 'string' && bankName.length > 0,
                `${file}: bankName should be a non-empty string, got "${bankName}"`
            );
        }
    });

    it('all function exports should have correct arity', async () => {
        const bankModules = await loadBankModules();
        const { arity: functionArity } = await parseRequiredExports();

        for (const { file, module } of bankModules) {
            for (const [funcName, expectedCount] of Object.entries(functionArity)) {
                const func = module[funcName];

                assert.strictEqual(
                    func.length,
                    expectedCount,
                    `${file}: function "${funcName}" should have ${expectedCount} parameter(s), but has ${func.length}`
                );
            }
        }
    });
});
