// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: MIT
// License: see LICENSE in the repository root.

module.exports = {testDir: __dirname, testMatch: '*.spec.js', workers: 1, retries: 0, reporter: 'list', use: {browserName: process.env.MTC_BROWSER || 'chromium', headless: true}, outputDir: '../../artifacts/playwright'};
