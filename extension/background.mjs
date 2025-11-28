/**
 * Background service worker that persists data and coordinates between popup and content scripts
 * @typedef {import('../bank/bank.types').Account} Account
 * @typedef {import('../bank/bank.types').Statement} Statement
 * @typedef {import('./extension.type').BackgroundMessage} BackgroundMessage
 * @typedef {import('./extension.type').BackgroundResponse} BackgroundResponse
 * @typedef {import('./extension.type').MessageResponse} MessageResponse
 * @typedef {import('./extension.type').MessageAction} MessageAction
 * @typedef {import('./extension.type').MessageDataMap} MessageDataMap
 * @typedef {import('./extension.type').RequestFetchMessage} RequestFetchMessage
 * @typedef {import('./extension.type').RequestFetchSuccessResponse} RequestFetchSuccessResponse
 * @typedef {import('./extension.type').RequestFetchErrorResponse} RequestFetchErrorResponse
 */

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds

/**
 * Send a message to the content script in a specific tab
 * @template {MessageAction} A
 * @param {number} tabId
 * @param {A} action - The action to perform
 * @param {MessageDataMap[A]['request']} data - The request data
 * @returns {Promise<MessageDataMap[A]['response']>}
 */
async function sendMessageToContentScript(tabId, action, data) {
    const message = { action, ...data };

    /** @type {MessageResponse} */
    const response = await chrome.tabs.sendMessage(tabId, message);

    if (response.action === 'error') {
        throw new Error(response.error || 'Unknown error from content script');
    }

    /** @type {MessageDataMap[A]['response']} */
    return response.data;
}

/**
 * @template T
 * @typedef {{ data: T; timestamp: number }} CacheEntry
 */

/**
 * Get cached data from chrome.storage.session
 * @template {MessageAction} A
 * @param {A} action
 * @param {string} suffix - Additional cache key suffix
 * @returns {Promise<MessageDataMap[A]['response'] | null>}
 */
async function getCachedData(action, suffix) {
    const key = `cached_${action}_${suffix}`;
    try {
        const result = await chrome.storage.session.get(key);
        const cached = /** @type {CacheEntry<MessageDataMap[A]['response']> | undefined} */ (result[key]);

        if (!cached) {
            return null;
        }

        // Check if cache has expired
        const age = Date.now() - cached.timestamp;
        if (age > CACHE_TTL) {
            await chrome.storage.session.remove(key);
            return null;
        }

        return cached.data;
    } catch (error) {
        console.error('Cache read error:', error);
        return null;
    }
}

/**
 * Set cached data in chrome.storage.session
 * @template {MessageAction} A
 * @param {A} action
 * @param {string} suffix - Additional cache key suffix
 * @param {MessageDataMap[A]['response']} data
 * @returns {Promise<void>}
 */
async function setCachedData(action, suffix, data) {
    const key = `cached_${action}_${suffix}`;
    try {
        await chrome.storage.session.set({
            [key]: {
                data,
                timestamp: Date.now()
            }
        });
    } catch (error) {
        console.error('Cache write error:', error);
    }
}

/**
 * Handle fetch request from content script
 * @param {RequestFetchMessage} fetchMessage
 * @returns {Promise<RequestFetchSuccessResponse>}
 */
async function handleFetchRequest(fetchMessage) {
    const response = await fetch(fetchMessage.url, fetchMessage.options);
    /** @type {Record<string, string>} */
    const headers = {};
    response.headers.forEach((value, key) => {
        headers[key] = value;
    });

    // For binary data (like PDFs), convert to base64
    const contentType = response.headers.get('content-type') || '';
    let body;
    if (contentType.includes('pdf') || contentType.includes('octet-stream')) {
        const blob = await response.blob();
        const reader = new FileReader();
        await new Promise((resolve) => {
            reader.onloadend = () => resolve(undefined);
            reader.readAsDataURL(blob);
        });
        body = /** @type {string} */ (reader.result);
    } else {
        body = await response.text();
    }

    return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers,
        body
    };
}

/**
 * Handle messages from popup and content scripts
 * @param {BackgroundMessage} message
 * @param {chrome.runtime.MessageSender} sender
 * @param {(response: BackgroundResponse) => void} sendResponse
 * @returns {boolean}
 */
function handleMessage(message, sender, sendResponse) {
    (async () => {
        try {
            if (!message.action) {
                throw new Error('Message must have an action');
            }

            // Get the active tab for communication with content script
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) {
                throw new Error('Unable to determine current tab');
            }

            const tabId = tab.id;

            switch (message.action) {
                case 'getBankId': {
                    const bankId = await sendMessageToContentScript(tabId, 'getBankId', {});
                    sendResponse({ success: true, data: bankId });
                    break;
                }

                case 'getBankName': {
                    const bankName = await sendMessageToContentScript(tabId, 'getBankName', {});
                    sendResponse({ success: true, data: bankName });
                    break;
                }

                case 'getSessionId': {
                    const sessionId = await sendMessageToContentScript(tabId, 'getSessionId', {});
                    sendResponse({ success: true, data: sessionId });
                    break;
                }

                case 'getAccounts': {
                    const bankId = await sendMessageToContentScript(tabId, 'getBankId', {});
                    const sessionId = await sendMessageToContentScript(tabId, 'getSessionId', {});
                    const cacheSuffix = `${bankId}_${sessionId}`;

                    // Check cache first
                    let accounts = await getCachedData('getAccounts', cacheSuffix);

                    if (!accounts || message.forceRefresh) {
                        accounts = await sendMessageToContentScript(tabId, 'getAccounts', {});
                        await setCachedData('getAccounts', cacheSuffix, accounts);
                    }

                    sendResponse({ success: true, data: accounts });
                    break;
                }

                case 'getStatements': {
                    if (!message.account) {
                        throw new Error('Account is required for getStatements');
                    }

                    const bankId = await sendMessageToContentScript(tabId, 'getBankId', {});
                    const sessionId = await sendMessageToContentScript(tabId, 'getSessionId', {});
                    const cacheSuffix = `${bankId}_${sessionId}_${message.account.accountId}`;

                    // Check cache first
                    let statements = await getCachedData('getStatements', cacheSuffix);

                    if (!statements) {
                        statements = await sendMessageToContentScript(tabId, 'getStatements', { account: message.account });
                        await setCachedData('getStatements', cacheSuffix, statements);
                    }

                    sendResponse({ success: true, data: statements });
                    break;
                }

                case 'downloadStatement': {
                    if (!message.statement) {
                        throw new Error('Statement is required for downloadStatement');
                    }

                    const base64Data = await sendMessageToContentScript(tabId, 'downloadStatement', { statement: message.statement });
                    sendResponse({ success: true, data: base64Data });
                    break;
                }

                case 'clearCache': {
                    await chrome.storage.session.clear();
                    sendResponse({ success: true, data: null });
                    break;
                }

                case 'requestFetch': {
                    try {
                        const successResponse = await handleFetchRequest(message);
                        sendResponse(successResponse);
                    } catch (error) {
                        /** @type {RequestFetchErrorResponse} */
                        const errorResponse = {
                            error: error instanceof Error ? error.message : String(error)
                        };
                        sendResponse(errorResponse);
                    }
                    break;
                }

                default: {
                    const unknownAction = /** @type {any} */ (message).action;
                    throw new Error(`Unknown action: ${unknownAction}`);
                }
            }
        } catch (error) {
            const err = /** @type {Error} */ (error);
            sendResponse({ success: false, error: err.message });
        }
    })();

    return true; // Keep channel open for async response
}

chrome.runtime.onMessage.addListener(handleMessage);

/**
 * Check if a URL matches any of the supported bank patterns
 * @param {string | undefined} url
 * @returns {boolean}
 */
function isSupportedUrl(url) {
    if (!url) return false;

    const supportedPatterns = [
        'americanexpress.com',
        'bankofamerica.com',
        'bmo.com',
        'chase.com',
        'chime.com',
        'citi.com',
        'discover.com',
        'eqbank.ca',
        'fidelity.com',
        'firsttechfed.com',
        'us.hsbc.com',
        'mbna.ca',
        'paypal.com',
        'questrade.com',
        'simplii.com',
        'sofi.com',
        'tangerine.ca',
        'td.com',
        'usbank.com',
        'vmd.ca',
        'wealthsimple.com',
        'wise.com'
    ];

    return supportedPatterns.some(pattern => url.includes(pattern));
}

/**
 * Update the extension icon based on whether the current tab's URL is supported
 * @param {number} tabId
 * @param {string | undefined} url
 */
async function updateIcon(tabId, url) {
    const isSupported = isSupportedUrl(url);
    const iconPath = isSupported
        ? chrome.runtime.getURL('extension/icon.png')
        : chrome.runtime.getURL('extension/icon-disabled.png');
    await chrome.action.setIcon({ tabId, path: iconPath });
}

// Listen for tab updates to change icon
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
        updateIcon(tabId, tab.url);
    }
});

// Listen for tab activation to change icon
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    updateIcon(activeInfo.tabId, tab.url);
});

// Initialize icon for all existing tabs when extension loads
chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
        if (tab.id) {
            updateIcon(tab.id, tab.url);
        }
    }
});
