/**
 * Wise Bank API implementation for retrieving bank statements
 * @see analyze/wise.md
 */

/** @type {string} */
export const bankId = 'wise';

/** @type {string} */
export const bankName = 'Wise';

const BASE_URL = 'https://wise.com';

/**
 * Retrieves the current session ID from cookies
 * Note: appToken cookie is HttpOnly and not accessible via JavaScript.
 * Using selected-profile-id cookie as the session identifier instead.
 * @returns {string} The selected-profile-id cookie value
 */
export function getSessionId() {
    const cookies = document.cookie.split('; ');
    for (const cookie of cookies) {
        const [name, ...valueParts] = cookie.split('=');
        if (name.startsWith('selected-profile-id-')) {
            // Return the full cookie string including name (contains user ID)
            return name + '=' + valueParts.join('=');
        }
    }
    throw new Error('selected-profile-id cookie not found. User may not be logged in to Wise.');
}

/**
 * Retrieves the current profile information
 * @param {string} sessionId - The session ID
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        // Fetch the home page
        const response = await fetch(`${BASE_URL}/home`, {
            method: 'GET',
            headers: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'same-origin',
            },
            credentials: 'include',
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch home page: ${response.status} ${response.statusText}`);
        }

        const html = await response.text();

        // Extract __NEXT_DATA__ JSON from the page
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
        if (!match) {
            throw new Error('Could not find __NEXT_DATA__ in home page');
        }

        const nextData = JSON.parse(match[1]);

        // Extract user information from the pageProps
        const pageProps = nextData?.props?.pageProps;
        if (!pageProps) {
            throw new Error('Invalid __NEXT_DATA__ structure: missing pageProps');
        }

        // Extract userId and profileId from session and selectedProfile
        const userId = pageProps.session?.userId;
        const profileId = pageProps.selectedProfile?.id;
        const profileName = pageProps.selectedProfile?.fullName || 'Wise User';

        if (!userId) {
            throw new Error('Could not extract userId from home page');
        }
        if (!profileId) {
            throw new Error('Could not extract profileId from home page');
        }

        return {
            sessionId,
            profileId: String(profileId),
            profileName,
        };
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get profile: ${err.message}`);
    }
}

/**
 * Retrieves all accounts for the logged-in user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        // Fetch the home page
        const response = await fetch(`${BASE_URL}/home`, {
            method: 'GET',
            headers: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'same-origin',
            },
            credentials: 'include',
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch home page: ${response.status} ${response.statusText}`);
        }

        const html = await response.text();

        // Extract __NEXT_DATA__ JSON from the page
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
        if (!match) {
            throw new Error('Could not find __NEXT_DATA__ in home page');
        }

        const nextData = JSON.parse(match[1]);

        // Extract launchpad data which contains balances
        const launchpadData = nextData?.props?.pageProps?.launchpadData;
        if (!launchpadData) {
            throw new Error('Invalid __NEXT_DATA__ structure: missing launchpadData');
        }

        const accounts = [];

        // Navigate through nested components to find balance entries
        // Structure: launchpadData.components[] -> section.components[] -> "Section - Balances".components[]
        if (Array.isArray(launchpadData.components)) {
            for (const section of launchpadData.components) {
                if (Array.isArray(section.components)) {
                    for (const component of section.components) {
                        // Find the "Section - Balances" component
                        if (component.trackingName === 'Section - Balances' && Array.isArray(component.components)) {
                            for (const balance of component.components) {
                                // Only include actual balance accounts (not "Add currency" entries)
                                if (balance.urn && balance.urn.includes('urn:wise:balances:') && balance.type === 'BALANCE') {
                                    const balanceId = balance.urn.split(':').pop();
                                    const currency = balance.title;
                                    // Remove dot characters and spaces from account mask
                                    const accountMask = balance.label?.text?.replace(/[·\s]/g, '').trim() || balanceId.slice(-4);
                                    // Use just the currency code as the account name (matches Wise UI)
                                    const accountName = currency;

                                    /** @type {import('./bank.types').AccountType} */
                                    const accountType = 'Checking'; // Wise accounts are multi-currency balances (treated as checking)

                                    accounts.push({
                                        profile,
                                        accountId: String(balanceId),
                                        accountName,
                                        accountMask,
                                        accountType,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        if (accounts.length === 0) {
            throw new Error('No accounts found in launchpad data');
        } return accounts;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get accounts: ${err.message}`);
    }
}

/**
 * Retrieves all statements for a specific account
 * Since Wise uses dynamic statement generation with date ranges,
 * we return predefined monthly statements for the last 12 months
 * @param {import('./bank.types').Account} account - The account to get statements for
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    try {
        // Generate monthly statements for the last 12 months
        // Skip the current month since it's not complete yet
        const statements = [];
        const now = new Date();

        for (let i = 1; i <= 12; i++) {
            const statementDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const endDate = new Date(statementDate.getFullYear(), statementDate.getMonth() + 1, 0);

            // Format dates as YYYY-MM-DD
            const startDateStr = `${statementDate.getFullYear()}-${String(statementDate.getMonth() + 1).padStart(2, '0')}-01`;
            const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

            // Create a statement ID that encodes the date range
            const statementId = `${startDateStr},${endDateStr}`;

            statements.push({
                account,
                statementId,
                statementDate: statementDate.toISOString(),
            });
        }

        return statements;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get statements for account ${account.accountId}: ${err.message}`);
    }
}

/**
 * Downloads a statement PDF file
 * First checks for existing statements (stored for 30 days), otherwise creates a new one
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    try {
        const profileId = statement.account.profile.profileId;
        const balanceId = statement.account.accountId;
        const dateRange = statement.statementId; // Format: YYYY-MM-DD,YYYY-MM-DD
        const [fromDate, toDate] = dateRange.split(',');

        // Step 0: Check for existing statements (stored for 30 days)
        const refreshUrl = `${BASE_URL}/hold/v1/profiles/${profileId}/statements-and-reports/balance-statement?action=refresh&balanceId=${balanceId}`;

        const refreshResponse = await fetch(refreshUrl, {
            method: 'POST',
            headers: {
                'accept': '*/*',
                'content-type': 'application/json',
                'origin': BASE_URL,
                'referer': `${BASE_URL}/balances/statements/balance-statement?balance_id=${balanceId}&df=true&schedule=custom`,
                // Public API token - same for all users, visible in Wise's frontend code
                'x-access-token': 'Tr4n5f3rw153',
                'time-zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
            },
            credentials: 'include',
            body: JSON.stringify({ schedule: 'custom' }),
        });

        if (!refreshResponse.ok) {
            throw new Error(`Failed to check existing statements: ${refreshResponse.status} ${refreshResponse.statusText}`);
        }

        const refreshData = /** @type {any} */ (await refreshResponse.json());

        // Look for an existing statement matching the date range
        let existingRequestId = null;
        if (refreshData.layout && Array.isArray(refreshData.layout)) {
            for (const layoutItem of refreshData.layout) {
                if (layoutItem.control === 'statements-list-item-with-action' && Array.isArray(layoutItem.items)) {
                    for (const item of layoutItem.items) {
                        // Parse the date range from the title
                        // Format can be: "October 1, 2025 - October 31, 2025" or "1 October 2025 - 31 October 2025"
                        const titleMatch = item.title?.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})\s+-\s+(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
                        if (titleMatch) {
                            const [, startMonth, startDay, startYear, endMonth, endDay, endYear] = titleMatch;
                            /** @type {Record<string, string>} */
                            const monthMap = {
                                'January': '01', 'February': '02', 'March': '03', 'April': '04',
                                'May': '05', 'June': '06', 'July': '07', 'August': '08',
                                'September': '09', 'October': '10', 'November': '11', 'December': '12'
                            };
                            const itemFrom = `${startYear}-${monthMap[startMonth]}-${startDay.padStart(2, '0')}`;
                            const itemTo = `${endYear}-${monthMap[endMonth]}-${endDay.padStart(2, '0')}`;

                            if (itemFrom === fromDate && itemTo === toDate) {
                                // Found a matching statement, extract the request ID from the download URL in tags
                                if (Array.isArray(item.tags)) {
                                    for (const tag of item.tags) {
                                        if (typeof tag === 'string' && tag.includes('statement-requests')) {
                                            try {
                                                const tagData = JSON.parse(tag);
                                                const urlMatch = tagData.url?.match(/statement-requests\/([a-f0-9-]+)\//);
                                                if (urlMatch) {
                                                    existingRequestId = urlMatch[1];
                                                    break;
                                                }
                                            } catch (e) {
                                                // Ignore parse errors
                                            }
                                        }
                                    }
                                }
                                if (existingRequestId) break;
                            }
                        }
                    }
                }
                if (existingRequestId) break;
            }
        }

        // Calculate the preset date ranges (required by the API for both create and poll)
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        let requestId = existingRequestId;

        // If no existing statement found, create a new one
        if (!requestId) {
            // Step 1: Create a statement request

            const createUrl = `${BASE_URL}/hold/v1/profiles/${profileId}/statements-and-reports/balance-statement/create?action=request&referrer=create&balanceId=${balanceId}`;

            const createResponse = await fetch(createUrl, {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'origin': BASE_URL,
                    'referer': `${BASE_URL}/balances/statements/balance-statement/create?balance_id=${balanceId}&df=true&schedule=monthly`,
                    // Public API token - same for all users, visible in Wise's frontend code
                    'x-access-token': 'Tr4n5f3rw153',
                    'time-zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-origin',
                },
                credentials: 'include',
                body: JSON.stringify({
                    todayRange: `${todayStr},${todayStr}`,
                    yesterdayRange: `${yesterdayStr},${yesterdayStr}`,
                    lastMonthRange: dateRange, // Use the target date range
                    lastQuarterRange: '',
                    lastYearRange: '',
                    previousDateRange: dateRange,
                    previousFrom: fromDate,
                    previousTo: toDate,
                    dateRange: dateRange,
                    from: fromDate,
                    to: toDate,
                    balances: [parseInt(balanceId, 10)],
                    fileFormat: 'PDF',
                    splitFees: true,
                    locale: 'en-GB',
                }),
            });

            if (!createResponse.ok) {
                throw new Error(`Failed to create statement request: ${createResponse.status} ${createResponse.statusText}`);
            }

            const createData = /** @type {any} */ (await createResponse.json());

            // Extract statement request ID from the action URL
            const actionUrl = createData.action?.url;
            if (!actionUrl) {
                throw new Error('No action URL returned from create statement API');
            }

            // Extract statement request ID from URL pattern:
            // /hold/v1/profiles/{profileId}/statements-and-reports/balance-statement/{requestId}
            const requestIdMatch = actionUrl.match(/balance-statement\/([a-f0-9-]+)/);
            if (!requestIdMatch) {
                throw new Error('Could not extract statement request ID from action URL');
            }
            requestId = requestIdMatch[1];

            // Step 2: Poll for statement generation completion
            const maxAttempts = 30; // Poll for up to 30 seconds
            const pollInterval = 1000; // Poll every 1 second

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));

                const pollUrl = `${BASE_URL}/hold/v1/profiles/${profileId}/statements-and-reports/balance-statement/${requestId}?referrer=create&balanceId=${balanceId}`;

                const pollResponse = await fetch(pollUrl, {
                    method: 'POST',
                    headers: {
                        'accept': 'application/json',
                        'content-type': 'application/json',
                        'origin': BASE_URL,
                        'referer': `${BASE_URL}/balances/statements/balance-statement/${requestId}?balance_id=${balanceId}`,
                        // Public API token - same for all users, visible in Wise's frontend code
                        'x-access-token': 'Tr4n5f3rw153',
                        'time-zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-mode': 'cors',
                        'sec-fetch-site': 'same-origin',
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        todayRange: `${todayStr},${todayStr}`,
                        yesterdayRange: `${yesterdayStr},${yesterdayStr}`,
                        lastMonthRange: dateRange,
                        lastQuarterRange: '',
                        lastYearRange: '',
                        previousDateRange: dateRange,
                        previousFrom: fromDate,
                        previousTo: toDate,
                        dateRange: dateRange,
                        from: fromDate,
                        to: toDate,
                        balances: [parseInt(balanceId, 10)],
                        fileFormat: 'PDF',
                        splitFees: true,
                        locale: 'en-GB',
                    }),
                });

                if (!pollResponse.ok) {
                    throw new Error(`Failed to poll statement status: ${pollResponse.status} ${pollResponse.statusText}`);
                }

                const pollData = /** @type {any} */ (await pollResponse.json());

                // Check if the response indicates completion
                // Look for the download button in the layout components
                if (pollData.layout && Array.isArray(pollData.layout)) {
                    for (const layoutItem of pollData.layout) {
                        if (Array.isArray(layoutItem.components)) {
                            for (const component of layoutItem.components) {
                                // The download button is a markdown component with control="statements-download-action-button"
                                if (component.control === 'statements-download-action-button' && component.content) {
                                    // Statement is ready for download
                                    break;
                                }
                            }
                        }
                    }
                    // If we found the download button, exit the polling loop
                    const hasDownloadButton = pollData.layout.some(/** @param {any} item */ item =>
                        Array.isArray(item.components) && item.components.some(/** @param {any} c */ c =>
                            c.control === 'statements-download-action-button'
                        )
                    );
                    if (hasDownloadButton) {
                        break;
                    }
                }

                if (pollData.error) {
                    throw new Error(`Statement generation failed: ${pollData.error}`);
                }

                // If we're still on the last attempt, fail
                if (attempt === maxAttempts - 1) {
                    throw new Error('Statement generation timed out after 30 seconds');
                }
            }
        }

        // Step 3: Download the PDF using the gateway endpoint
        const downloadPath = `/gateway/v1/profiles/${profileId}/statement-requests/${requestId}/statement-file`;

        const downloadResponse = await fetch(`${BASE_URL}${downloadPath}`, {
            method: 'GET',
            headers: {
                'accept': '*/*',
                'content-type': 'application/json',
                'referer': `${BASE_URL}/balances/statements/balance-statement?balance_id=${balanceId}&df=true&schedule=custom`,
                // Public API token - same for all users, visible in Wise's frontend code
                'x-access-token': 'Tr4n5f3rw153',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
            },
            credentials: 'include',
        });

        if (!downloadResponse.ok) {
            throw new Error(`Failed to download PDF: ${downloadResponse.status} ${downloadResponse.statusText}`);
        }

        const blob = await downloadResponse.blob();

        if (blob.size === 0) {
            throw new Error('Downloaded PDF is empty');
        }

        return blob;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to download statement ${statement.statementId}: ${err.message}`);
    }
}
