/**
 * @typedef {import('../bank/bank.types').Account} Account
 * @typedef {import('../bank/bank.types').Statement} Statement
 * @typedef {import('./extension.type').MessageAction} MessageAction
 * @typedef {import('./extension.type').MessageDataMap} MessageDataMap
 */

/**
 * Send a message to the background service worker
 * @template {MessageAction} A
 * @param {A} action - The action to perform
 * @param {MessageDataMap[A]['request'] & {forceRefresh?: boolean}} data - The request data
 * @returns {Promise<MessageDataMap[A]['response']>}
 */
async function sendMessageToBackground(action, data) {
    const message = { action, ...data };

    const response = await chrome.runtime.sendMessage(message);

    if (!response.success) {
        throw new Error(response.error || 'Unknown error from background script');
    }

    /** @type {MessageDataMap[A]['response']} */
    return response.data;
}

/**
 * Format date for display
 * @param {string} isoDateString - ISO 8601 date string (YYYY-MM-DD)
 * @returns {string}
 */
function formatDate(isoDateString) {
    // Parse date components directly to avoid timezone issues
    const [year, month, day] = isoDateString.split('T')[0].split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

/**
 * Trigger browser download for a blob
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Render the UI with accounts and statements
 * @param {Account[]} accounts
 */
function renderAccounts(accounts) {
    const appDiv = document.getElementById('app');
    if (!appDiv) return;

    appDiv.innerHTML = '';

    if (accounts.length === 0) {
        appDiv.innerHTML = '<div class="no-statements">No accounts found</div>';
        return;
    }

    accounts.forEach(account => {
        const accountDiv = document.createElement('div');
        accountDiv.className = 'account';
        accountDiv.dataset.accountId = account.accountId;

        const header = document.createElement('div');
        header.className = 'account-header';
        header.innerHTML = `
            <div>
                <span class="account-name">${account.accountName}</span>
                <span class="account-mask">••${account.accountMask}</span>
            </div>
            <span class="expand-icon">▶</span>
        `;

        const statementsDiv = document.createElement('div');
        statementsDiv.className = 'statements';
        statementsDiv.innerHTML = '<div class="loading" style="padding: 12px;">Loading statements...</div>';

        accountDiv.appendChild(header);
        accountDiv.appendChild(statementsDiv);
        appDiv.appendChild(accountDiv);

        // Toggle expand/collapse
        header.addEventListener('click', async () => {
            const isExpanded = accountDiv.classList.contains('expanded');

            if (!isExpanded) {
                accountDiv.classList.add('expanded');

                // Load statements if not already loaded
                if (!accountDiv.dataset.statementsLoaded) {
                    try {
                        const statements = await sendMessageToBackground('getStatements', { account });
                        renderStatements(statementsDiv, account, statements);
                        accountDiv.dataset.statementsLoaded = 'true';
                    } catch (error) {
                        const err = /** @type {Error} */ (error);
                        statementsDiv.innerHTML = `<div class="error">Failed to load statements: ${err.message}</div>`;
                    }
                }
            } else {
                accountDiv.classList.remove('expanded');
            }
        });
    });
}

/**
 * Render statements for an account
 * @param {HTMLElement} container
 * @param {Account} account
 * @param {Statement[]} statements
 */
function renderStatements(container, account, statements) {
    if (statements.length === 0) {
        container.innerHTML = '<div class="no-statements">No statements available</div>';
        return;
    }

    container.innerHTML = '';

    // Create error message div (initially hidden)
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.style.display = 'none';
    errorDiv.style.marginBottom = '8px';
    container.appendChild(errorDiv);

    statements.forEach(statement => {
        const statementDiv = document.createElement('div');
        statementDiv.className = 'statement-item';
        statementDiv.innerHTML = `
            <span class="statement-date">${formatDate(statement.statementDate)}</span>
            <span class="statement-status"></span>
        `;

        statementDiv.addEventListener('click', async () => {
            if (statementDiv.classList.contains('downloading')) {
                return;
            }

            statementDiv.classList.add('downloading');
            const statusSpan = statementDiv.querySelector('.statement-status');
            if (!statusSpan) return;

            statusSpan.textContent = 'Downloading...';

            try {
                const base64Data = await sendMessageToBackground('downloadStatement', { statement });
                // Convert base64 back to blob
                const response = await fetch(base64Data);
                const blob = await response.blob();

                const bankName = await sendMessageToBackground('getBankName', {});
                const profileName = account.profile.profileName.includes('@')
                    ? account.profile.profileName.split('@')[0]
                    : account.profile.profileName;
                const filename = `${statement.statementDate.split('T')[0]}_${bankName}_${profileName}_${account.accountName}_${account.accountMask}.pdf`;
                triggerDownload(blob, filename);
                statusSpan.textContent = '✓ Downloaded';
                setTimeout(() => {
                    statementDiv.classList.remove('downloading');
                    statusSpan.textContent = '';
                }, 2000)
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                // Show error at the top of the statements list
                errorDiv.textContent = errorMessage;
                errorDiv.style.display = 'block';

                // Update status to failed
                statusSpan.textContent = '✗ Failed';
                statementDiv.classList.remove('downloading');

                // Clear status after a delay
                setTimeout(() => {
                    statusSpan.textContent = '';
                }, 2000);

                console.error('Download error:', error);
            }
        });

        container.appendChild(statementDiv);
    });
}

/**
 * Show error message
 * @param {string} message
 */
function showError(message) {
    const appDiv = document.getElementById('app');
    if (!appDiv) return;
    appDiv.innerHTML = `<div class="error">${message}</div>`;
}

/**
 * Get user-friendly error message
 * @param {Error} error
 * @returns {string}
 */
function getErrorMessage(error) {
    const message = error.message;

    // Check for content script not loaded (unsupported website or page needs refresh)
    if (message.includes('Receiving end does not exist') || message.includes('Could not establish connection')) {
        return 'This website is not supported. Please navigate to a supported bank website.';
    }

    // Default error message
    return `Failed to load accounts: ${message}`;
}

/**
 * Initialize the popup
 * @param {boolean} [forceRefresh=false]
 */
async function init(forceRefresh = false) {
    const refreshBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('refresh-btn'));

    try {
        if (refreshBtn) {
            refreshBtn.classList.add('refreshing');
            refreshBtn.disabled = true;
        }

        if (forceRefresh) {
            await sendMessageToBackground('clearCache', {});
        }

        const accounts = await sendMessageToBackground('getAccounts', { forceRefresh });
        renderAccounts(accounts);
    } catch (error) {
        const err = /** @type {Error} */ (error);
        const errorMessage = getErrorMessage(err);
        showError(errorMessage);
        console.error('Init error:', error);
    } finally {
        if (refreshBtn) {
            refreshBtn.classList.remove('refreshing');
            refreshBtn.disabled = false;
        }
    }
}

// Setup refresh button and initialize
document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('refresh-btn'));
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            init(true);
        });
    }

    // Start when popup opens
    init();
});
