/**
 * Content script that executes in the context of the bank's web page
 * This allows API calls to be made with the page's cookies and authentication
 * @typedef {import('./extension.type').ContentMessage} ContentMessage
 * @typedef {import('./extension.type').MessageResponse} MessageResponse
 * @typedef {typeof import('../bank/bank.types')} BankModule
 */

/** @type {BankModule | null} */
let bankModule = null;

/**
 * Get the bank module based on the current page URL
 * Only imports the specific bank module needed
 * @returns {Promise<BankModule>}
 */
async function getBankModule() {
    if (bankModule) {
        return bankModule;
    }

    const hostname = window.location.hostname;

    if (hostname.includes('chase.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/chase.mjs'));
        if (!bankModule) throw new Error('Failed to load Chase module');
        return bankModule;
    }

    if (hostname.includes('americanexpress.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/american_express.mjs'));
        if (!bankModule) throw new Error('Failed to load American Express module');
        return bankModule;
    }

    if (hostname.includes('bmo.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/bmo.mjs'));
        if (!bankModule) throw new Error('Failed to load BMO module');
        return bankModule;
    }

    if (hostname.includes('bankofamerica.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/bank_of_america.mjs'));
        if (!bankModule) throw new Error('Failed to load Bank of America module');
        return bankModule;
    }

    if (hostname.includes('chime.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/chime.mjs'));
        if (!bankModule) throw new Error('Failed to load Chime module');
        return bankModule;
    }

    if (hostname.includes('citi.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/citi.mjs'));
        if (!bankModule) throw new Error('Failed to load Citi module');
        return bankModule;
    }

    if (hostname.includes('discover.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/discover.mjs'));
        if (!bankModule) throw new Error('Failed to load Discover module');
        return bankModule;
    }

    if (hostname.includes('eqbank.ca')) {
        bankModule = await import(chrome.runtime.getURL('bank/eq_bank.mjs'));
        if (!bankModule) throw new Error('Failed to load EQ Bank module');
        return bankModule;
    }

    if (hostname.includes('fidelity.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/fidelity.mjs'));
        if (!bankModule) throw new Error('Failed to load Fidelity module');
        return bankModule;
    }

    if (hostname.includes('firsttechfed.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/first_tech_fcu.mjs'));
        if (!bankModule) throw new Error('Failed to load First Tech FCU module');
        return bankModule;
    }

    if (hostname.includes('us.hsbc.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/hsbc_us.mjs'));
        if (!bankModule) throw new Error('Failed to load HSBC US module');
        return bankModule;
    }

    if (hostname.includes('mbna.ca')) {
        bankModule = await import(chrome.runtime.getURL('bank/mbna_ca.mjs'));
        if (!bankModule) throw new Error('Failed to load MBNA Canada module');
        return bankModule;
    }

    if (hostname.includes('paypal.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/paypal.mjs'));
        if (!bankModule) throw new Error('Failed to load PayPal module');
        return bankModule;
    }

    if (hostname.includes('questrade.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/questrade.mjs'));
        if (!bankModule) throw new Error('Failed to load Questrade module');
        return bankModule;
    }

    if (hostname.includes('simplii.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/simplii.mjs'));
        if (!bankModule) throw new Error('Failed to load Simplii module');
        return bankModule;
    }

    if (hostname.includes('sofi.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/sofi.mjs'));
        if (!bankModule) throw new Error('Failed to load SoFi module');
        return bankModule;
    }

    if (hostname.includes('tangerine.ca')) {
        bankModule = await import(chrome.runtime.getURL('bank/tangerine.mjs'));
        if (!bankModule) throw new Error('Failed to load Tangerine module');
        return bankModule;
    }

    if (hostname === 'webbroker.td.com') {
        bankModule = await import(chrome.runtime.getURL('bank/td_broker.mjs'));
        if (!bankModule) throw new Error('Failed to load TD WebBroker module');
        return bankModule;
    }

    if (hostname.includes('td.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/td_bank.mjs'));
        if (!bankModule) throw new Error('Failed to load TD Bank module');
        return bankModule;
    }

    if (hostname.includes('usbank.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/us_bank.mjs'));
        if (!bankModule) throw new Error('Failed to load US Bank module');
        return bankModule;
    }

    if (hostname.includes('vmd.ca')) {
        bankModule = await import(chrome.runtime.getURL('bank/disnat.mjs'));
        if (!bankModule) throw new Error('Failed to load Disnat module');
        return bankModule;
    }

    if (hostname.includes('wealthsimple.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/wealthsimple.mjs'));
        if (!bankModule) throw new Error('Failed to load Wealthsimple module');
        return bankModule;
    }

    if (hostname.includes('wise.com')) {
        bankModule = await import(chrome.runtime.getURL('bank/wise.mjs'));
        if (!bankModule) throw new Error('Failed to load Wise module');
        return bankModule;
    }

    throw new Error(`Unsupported bank: ${hostname}`);
}

/**
 * Message handler for commands from the popup
 * @param {ContentMessage} message
 * @param {chrome.runtime.MessageSender} sender
 * @param {(response: MessageResponse) => void} sendResponse
 */
function handleMessage(message, sender, sendResponse) {
    (async () => {
        try {
            const bank = await getBankModule();

            switch (message.action) {
                case 'getBankId': {
                    sendResponse({ action: 'getBankId', data: bank.bankId });
                    break;
                }

                case 'getBankName': {
                    sendResponse({ action: 'getBankName', data: bank.bankName });
                    break;
                }

                case 'getSessionId': {
                    const sessionId = bank.getSessionId();
                    sendResponse({ action: 'getSessionId', data: sessionId });
                    break;
                }

                case 'getAccounts': {
                    const sessionId = bank.getSessionId();
                    const profile = await bank.getProfile(sessionId);
                    const accounts = await bank.getAccounts(profile);
                    sendResponse({ action: 'getAccounts', data: accounts });
                    break;
                }

                case 'getStatements': {
                    if (!message.account) {
                        throw new Error('Account is required for getStatements');
                    }
                    const statements = await bank.getStatements(message.account);
                    sendResponse({ action: 'getStatements', data: statements });
                    break;
                }

                case 'downloadStatement': {
                    if (!message.statement) {
                        throw new Error('Statement is required for downloadStatement');
                    }
                    const blob = await bank.downloadStatement(message.statement);

                    // Convert blob to base64 for message passing
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64data = /** @type {string} */ (reader.result);
                        sendResponse({ action: 'downloadStatement', data: base64data });
                    };
                    reader.readAsDataURL(blob);
                    return true; // Keep channel open for async response
                }
            }
        } catch (error) {
            const err = /** @type {Error} */ (error);
            sendResponse({ action: 'error', error: err.message });
        }
    })();

    // Return true to indicate we'll send a response asynchronously
    return true;
}

chrome.runtime.onMessage.addListener(handleMessage);