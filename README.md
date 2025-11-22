# Google Drive Inventory & Management Agent

A powerful Google Apps Script tool for analyzing, organizing, and cleaning up Google Drive. This agent provides a spreadsheet-based interface to scan your Drive, detect duplicates, and perform bulk operations like moving or deleting files.

## Features

*   **📊 Visual Dashboard**: View high-level stats (Total Files, Size, Duplicates) and charts in a Cyberpunk-themed modal.
*   **🔍 Deep Scan**: Recursively inventories your entire Drive or specific folders/Shared Drives.
*   **👯 Duplicate Detection**: Automatically flags duplicate files based on MD5 checksums.
*   **⚡ Bulk Actions**: Select multiple files in the spreadsheet to Delete or Move them in batch.
*   **🛠️ Single File Tools**: Rename, Move, Copy, or Delete individual files by ID.
*   **🛡️ Safety First**: Includes confirmation modals for destructive actions and retry logic for API stability.

## Installation

Since this is a Google Apps Script project, it runs directly inside a Google Sheet.

1.  **Create a new Google Sheet**.
2.  Go to **Extensions > Apps Script**.
3.  **Copy & Paste the Code**:
    *   Copy the content of `code/google-drive-inventory.js` into `Code.gs` (or rename to `google-drive-inventory.gs`).
    *   Create a new HTML file named `sidebar.html` and paste the content of `code/sidebar.html`.
    *   Create a new HTML file named `dashboard.html` and paste the content of `code/dashboard.html`.
4.  **Save** the project.
5.  **Reload** your Google Sheet.
6.  You will see a new menu item: **Inventory Tools**.

## Usage

1.  **Open Sidebar**: Click `Inventory Tools > Open Inventory Tool`.
2.  **Scan Drive**: Click "Inventory Everything" to scan your entire Drive, or paste a folder URL to scan a specific target.
3.  **View Dashboard**: Click "📊 View Dashboard" to see your Drive analytics.
4.  **Manage Files**:
    *   Use the **Single File Tools** in the sidebar to manage specific files by ID.
    *   **Bulk Operations**: Check the boxes in the "Select" column (Column A) of the `Inventory_Data` sheet, then use the "Bulk Actions" buttons in the sidebar.

## Project Structure

*   `code/`: Contains the source code for the Google Apps Script project.
    *   `google-drive-inventory.js`: Server-side logic (Drive API, Sheet operations).
    *   `sidebar.html`: Client-side UI for the sidebar.
    *   `dashboard.html`: Client-side UI for the dashboard modal.
*   `docs/`: Project documentation and implementation details.

## Security

*   This script runs with your account permissions.
*   It does not share data externally.
*   Always review code before running it on sensitive data.
