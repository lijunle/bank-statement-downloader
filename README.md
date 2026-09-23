# Bank Statement Downloader

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Bank%20Statement%20Downloader-blue.svg)](https://chromewebstore.google.com/detail/bank-statement-extension/bfkhabnehallgnocdmembehakknegebb)
[![CI](https://github.com/lijunle/bank-statement-downloader/actions/workflows/ci.yml/badge.svg)](https://github.com/lijunle/bank-statement-downloader/actions/workflows/ci.yml)

## What is this for?

Bank Statement Downloader is a Chrome/Edge browser extension designed to simplify how you access and manage your financial data. It automatically extracts and displays bank statement information when you visit supported bank websites, providing an easier way to view, organize, and download your transaction history as PDF files.

## Key Features

- **🔒 Pure Client-Side Processing** - All data extraction and processing happen entirely within your browser. No banking data is ever sent to external servers.
- **🛡️ Privacy First** - Your financial information stays on your device. The extension never stores passwords, credentials, or sensitive authentication data.
- **🏦 Multi-Bank Support** - Seamlessly works across 20+ major banking websites.
- **📊 Automated Extraction** - Instantly identifies and extracts transaction data from complex bank pages.
- **👁️ Clean Visualization** - Presents your statement information in an organized, easy-to-read format.
- **📄 Easy PDF Export** - Download your statements as PDF files with a single click.
- **⚡ Lightweight Performance** - Built for speed using plain JavaScript with no external dependencies.

## Supported Banks

| Bank                                 | List Accounts | List Statements | Download Statements |
| :----------------------------------- | :-----------: | :-------------: | :-----------------: |
| American Express                     |      ✅       |       ✅        |         ✅          |
| Bank of America                      |      ✅       |       ✅        |         ✅          |
| BMO (Bank of Montreal)               |      ✅       |       ✅        |         ✅          |
| Chase Bank                           |      ✅       |       ✅        |         ✅          |
| Chime                                |      ✅       |       ✅        |         ✅          |
| Citibank                             |      ✅       |       ✅        |         ✅          |
| Discover                             |      ✅       |       ✅        |         ✅          |
| Disnat (Desjardins Online Brokerage) |      ✅       |       ✅        |         ✅          |
| EQ Bank                              |      ✅       |       ✅        |       ❌ [^1]       |
| Fidelity                             |      ✅       |     ⚠️ [^2]     |         ✅          |
| First Tech FCU                       |      ✅       |     ⚠️ [^3]     |         ✅          |
| HSBC US                              |      ✅       |       ✅        |         ✅          |
| MBNA Canada                          |      ✅       |       ✅        |         ✅          |
| PayPal                               |      ✅       |       ✅        |         ✅          |
| Questrade                            |      ✅       |       ✅        |         ✅          |
| Simplii Financial                    |      ✅       |       ✅        |         ✅          |
| SoFi                                 |      ✅       |       ✅        |         ✅          |
| Tangerine                            |      ✅       |       ✅        |         ✅          |
| TD Bank Canada                       |      ✅       |       ✅        |         ✅          |
| TD Direct Investing (WebBroker)      |      ✅       |       ✅        |         ✅          |
| US Bank                              |      ✅       |       ✅        |         ✅          |
| Wealthsimple                         |      ✅       |       ✅        |         ✅          |
| Wise                                 |      ✅       |     ⚠️ [^4]     |         ✅          |

[^1]: EQ Bank generates statement PDFs client-side. Support is currently under investigation.
[^2]: Fidelity can combine multiple investment accounts into one statement PDF. Open Fidelity's [Documents page](https://digitalservices.fidelity.com/navigate/ent-documentcenter/statements) to use the extension for investment and retirement statements.
[^3]: First Tech FCU combines checking and savings accounts into a single statement PDF file.
[^4]: Wise does not provide pre-generated statements; statements are generated on-demand for each month.

## License

MIT license.
