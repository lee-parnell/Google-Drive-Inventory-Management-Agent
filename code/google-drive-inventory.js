/**
 * Clean Drive Inventory (Engineering Refactor)
 * * CORE BEHAVIOR:
 * - Scans Drive files (recursive or flat).
 * - flags duplicates via MD5 checksum.
 * - Overwrites a single tab 'Inventory_Data' to act as a stable data source.
 */

const CONFIG = Object.freeze({
  targetSheetName: 'Inventory_Data',
  pageSize: 1000,       // API fetch size
  chunkRowSize: 2000,   // Spreadsheet write batch size
  includeTrashed: false // Set to true if you want to see bin items
});

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Inventory Tools')
    .addItem('Open Inventory Tool', 'showSidebar')
    .addItem('View Dashboard', 'showDashboard')
    .addSeparator()
    .addItem('Inventory Everything', 'inventoryDrive')
    .addItem('Inventory by URL/ID...', 'inventoryDriveFromPrompt')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('sidebar')
    .setTitle('Drive Inventory')
    .setWidth(400);
  SpreadsheetApp.getUi().showSidebar(html);
}

function showDashboard() {
  const html = HtmlService.createHtmlOutputFromFile('dashboard')
    .setWidth(800)
    .setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Drive Dashboard');
}

/**
 * User Interaction Wrappers
 */
function inventoryDriveFromPrompt() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Enter Drive or Folder URL',
    'Leave blank to inventory root Drive.',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  const input = response.getResponseText().trim();
  runSafeInventory_(input);
}

function runFullInventoryFromSidebar() {
  return runSafeInventory_(); // Empty input = Root
}

function runUrlInventoryFromSidebar(urlInput) {
  return runSafeInventory_(urlInput);
}

/**
 * Reorganization Tools
 */
function renameFile(fileId, newName) {
  try {
    const file = DriveApp.getFileById(fileId);
    file.setName(newName);
    return { success: true, message: `Renamed to "${newName}"` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function moveFile(fileId, targetFolderId) {
  try {
    const file = DriveApp.getFileById(fileId);
    const folder = DriveApp.getFolderById(targetFolderId);
    file.moveTo(folder);
    return { success: true, message: `Moved to "${folder.getName()}"` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function copyFile(fileId, targetFolderId, newName) {
  try {
    const file = DriveApp.getFileById(fileId);
    const folder = DriveApp.getFolderById(targetFolderId);
    const copy = file.makeCopy(newName || `Copy of ${file.getName()}`, folder);
    return { success: true, message: `Copied to "${folder.getName()}" as "${copy.getName()}"` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteFile(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
    return { success: true, message: `Moved "${file.getName()}" to trash` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Safety Wrapper: Handles errors and UI updates gracefully
 */
function runSafeInventory_(input) {
  try {
    const target = parseInventoryTarget_(input);
    const label = target.targetLabel || 'Full Drive';

    SpreadsheetApp.getActiveSpreadsheet().toast(`Starting scan: ${label}`, 'Working', -1);

    inventoryDrive(target); // Main execution

    return { success: true };
  } catch (err) {
    console.error(err);
    SpreadsheetApp.getActiveSpreadsheet().toast('Failed', 'Error', 5);
    return { success: false, error: err.message };
  }
}

/**
 * MAIN LOGIC
 */
function inventoryDrive(targetOptions) {
  const start = new Date();
  const options = targetOptions || { targetType: 'all' };

  // 1. Fetch
  const files = fetchDriveItems_(options);
  console.log(`Fetched ${files.length} items.`);

  // 2. Logic (Duplicate Detection)
  processDuplicates_(files);

  // 3. Context (Paths)
  const pathContext = buildPathContext_(files);

  // 4. Write (Overwrite Mode)
  writeToSheet_(files, pathContext);

  const duration = ((new Date() - start) / 1000).toFixed(2);
  SpreadsheetApp.getActiveSpreadsheet().toast(`Done! ${files.length} items in ${duration}s`, 'Success', 10);
}

/**
 * DATA FETCHING
 */
function fetchDriveItems_(options) {
  const targetType = options.targetType;

  if (targetType === 'all') return fetchAllVisibleItems_();
  if (targetType === 'drive') return fetchSharedDriveItems_(options.targetId);
  if (targetType === 'folder') return fetchFolderTree_(options.targetId);

  throw new Error(`Unknown target type: ${targetType}`);
}

function fetchAllVisibleItems_() {
  return listFilesWithParams_({
    corpora: 'allDrives',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: CONFIG.includeTrashed ? '' : 'trashed = false'
  });
}

function fetchSharedDriveItems_(driveId) {
  return listFilesWithParams_({
    corpora: 'drive',
    driveId: driveId,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: CONFIG.includeTrashed ? '' : 'trashed = false'
  });
}

// Recursive Folder Fetch (BFS)
function fetchFolderTree_(folderId) {
  let root;
  try {
    root = Drive.Files.get(folderId, { supportsAllDrives: true, fields: '*' });
  } catch (e) { throw new Error('Cannot access folder. Check permissions.'); }

  const results = [root];
  const queue = [root.id];
  const visited = new Set([root.id]);

  while (queue.length) {
    const parentId = queue.shift();
    // Escape the ID to prevent query injection
    const safeParentId = parentId.replace(/'/g, "\\'");
    const q = `'${safeParentId}' in parents` + (CONFIG.includeTrashed ? '' : ' and trashed = false');

    const children = listFilesWithParams_({
      q: q,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    });

    children.forEach(child => {
      if (!visited.has(child.id)) {
        visited.add(child.id);
        results.push(child);
        if (child.mimeType === FOLDER_MIME) queue.push(child.id);
      }
    });
  }
  return results;
}

function listFilesWithParams_(customParams) {
  let files = [];
  let pageToken = null;
  const params = {
    pageSize: CONFIG.pageSize,
    fields: 'nextPageToken, files(*)',
    ...customParams
  };

  do {
    params.pageToken = pageToken;
    let res;
    let retries = 3;
    while (retries > 0) {
      try {
        res = Drive.Files.list(params);
        break; // Success
      } catch (e) {
        console.warn(`Drive API Error (Retries left: ${retries - 1}): ${e.message}`);
        retries--;
        if (retries === 0) throw e;
        Utilities.sleep(2000); // Wait 2s before retry
      }
    }

    if (res.files) files = files.concat(res.files);
    pageToken = res.nextPageToken;
  } while (pageToken);

  return files;
}

/**
 * LOGIC HELPERS
 */
function processDuplicates_(files) {
  const map = new Map();

  // Group by MD5
  files.forEach(f => {
    if (!f.md5Checksum) return; // Skip folders/G-Docs
    if (!map.has(f.md5Checksum)) map.set(f.md5Checksum, []);
    map.get(f.md5Checksum).push(f);
  });

  // Sort and Flag
  map.forEach(group => {
    if (group.length > 1) {
      // Sort: Newest Modified Time first
      group.sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));

      // Flag all except the first one
      for (let i = 1; i < group.length; i++) {
        group[i].isDuplicate = true;
      }
    }
  });
}

function buildPathContext_(files) {
  const byId = new Map(files.map(f => [f.id, f]));
  const cache = new Map();
  const rootId = DriveApp.getRootFolder().getId();

  const resolve = (id, stack = new Set()) => {
    if (cache.has(id)) return cache.get(id);
    if (!byId.has(id)) return ''; // Orphan or parent not in scan scope

    const file = byId.get(id);
    if (stack.has(id)) return file.name; // Cycle detected
    stack.add(id);

    if (!file.parents || !file.parents.length) return file.name;

    const parentId = file.parents[0];
    if (parentId === rootId) return 'My Drive/' + file.name;

    const parentPath = resolve(parentId, stack);
    const fullPath = parentPath ? `${parentPath}/${file.name}` : file.name;

    cache.set(id, fullPath);
    return fullPath;
  };

  const paths = new Map();
  files.forEach(f => paths.set(f.id, resolve(f.id)));
  return { paths };
}

/**
 * OUTPUT HANDLERS
 */
function writeToSheet_(files, pathContext) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.targetSheetName);

  // Overwrite Logic
  if (sheet) {
    sheet.clear(); // Wipes data and formatting
  } else {
    sheet = ss.insertSheet(CONFIG.targetSheetName);
  }

  const headers = [
    'Select', 'fullPath', 'name', 'id', 'mimeType', 'isFolder', 'driveId', 'parents',
    'ownerEmails', 'sharingUser', 'lastModifyingUser', 'sizeBytes', 'createdTime',
    'modifiedTime', 'viewedByMeTime', 'sharedWithMeTime', 'trashed', 'starred',
    'version', 'md5Checksum', 'headRevisionId', 'shortcutDetails', 'permissionsCount',
    'labelNames', 'webViewLink', 'webContentLink'
  ];

  const rows = files.map(f => {
    return [
      false, // Checkbox placeholder
      pathContext.paths.get(f.id) || f.name,
      f.name,
      f.id,
      f.mimeType,
      f.mimeType === FOLDER_MIME,
      f.driveId || '',
      (f.parents || []).join(', '),
      (f.owners || []).map(o => o.emailAddress).join(', '),
      f.sharingUser?.emailAddress || '',
      f.lastModifyingUser?.emailAddress || '',
      f.size || '',
      f.createdTime,
      f.modifiedTime,
      f.viewedByMeTime || '',
      f.sharedWithMeTime || '',
      f.trashed,
      f.starred,
      f.version,
      f.md5Checksum || '',
      f.headRevisionId || '',
      f.shortcutDetails ? JSON.stringify(f.shortcutDetails) : '',
      (f.permissions || []).length,
      '', // labelNames placeholder
      f.webViewLink,
      f.webContentLink || ''
    ];
  });

  // Write Headers
  if (rows.length > 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f3f3f3');

    // Write Data in Chunks
    const numCols = headers.length;
    for (let i = 0; i < rows.length; i += CONFIG.chunkRowSize) {
      const chunk = rows.slice(i, i + CONFIG.chunkRowSize);
      sheet.getRange(2 + i, 1, chunk.length, numCols).setValues(chunk);
      SpreadsheetApp.flush(); // Prevent script timeout issues
    }

    // Insert Checkboxes in Column A
    sheet.getRange(2, 1, rows.length, 1).insertCheckboxes();

    // Formatting
    sheet.setFrozenRows(1);
    // Only resize first few cols to save time
    sheet.autoResizeColumns(2, 5);
  }
}

/**
 * INPUT PARSING
 */
function parseInventoryTarget_(input) {
  const cleanInput = (input || '').trim();
  if (!cleanInput) return { targetType: 'all' };

  const idMatch = cleanInput.match(/[-\w]{25,}/);
  const id = idMatch ? idMatch[0] : null;

  if (!id) throw new Error('Could not find a valid ID in that input.');

  // Check if it's a Drive or a Folder
  try {
    const drive = Drive.Drives.get(id);
    return { targetType: 'drive', targetId: id, targetLabel: `Shared Drive: ${drive.name}` };
  } catch (e) {
    // Not a drive, try folder
    try {
      const file = Drive.Files.get(id, { supportsAllDrives: true });
      if (file.mimeType === FOLDER_MIME) {
        return { targetType: 'folder', targetId: id, targetLabel: `Folder: ${file.name}` };
      }
      throw new Error('ID is a file, not a folder. Please select a folder.');
    } catch (e2) {
      throw new Error('Access denied or ID not found.');
    }
  }
}

/**
 * BULK OPERATIONS
 */
function processBulkDelete() {
  const ids = getCheckedFiles_();
  if (ids.length === 0) return { success: false, error: 'No files selected.' };

  let successCount = 0;
  let errors = [];

  ids.forEach(id => {
    const result = deleteFile(id);
    if (result.success) successCount++;
    else errors.push(result.error);
  });

  return {
    success: true,
    message: `Deleted ${successCount} files.` + (errors.length ? ` (${errors.length} failed)` : '')
  };
}

function processBulkMove(targetFolderId) {
  const ids = getCheckedFiles_();
  if (ids.length === 0) return { success: false, error: 'No files selected.' };

  let successCount = 0;
  let errors = [];

  ids.forEach(id => {
    const result = moveFile(id, targetFolderId);
    if (result.success) successCount++;
    else errors.push(result.error);
  });

  return {
    success: true,
    message: `Moved ${successCount} files.` + (errors.length ? ` (${errors.length} failed)` : '')
  };
}

function getCheckedFiles_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.targetSheetName);
  if (!sheet) throw new Error('Inventory sheet not found. Please run inventory first.');

  const data = sheet.getDataRange().getValues();
  const ids = [];

  // Assuming Row 1 is headers. Column A (index 0) is Checkbox, Column D (index 3) is ID.
  // Note: We added 'Select' at index 0, so 'id' is now at index 3.
  // Headers: Select, fullPath, name, id...

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === true) { // Checked
      ids.push(data[i][3]); // ID column
    }
  }
  return ids;
}

/**
 * DASHBOARD ANALYTICS
 */
function getDashboardData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.targetSheetName);
  if (!sheet) throw new Error('No inventory data found.');

  const data = sheet.getDataRange().getValues();
  // Headers are Row 1. Data starts Row 2.
  // Column Indices (0-based) AFTER adding Checkbox column:
  // 0: Select
  // 1: fullPath
  // 2: name
  // 3: id
  // 4: mimeType
  // 11: sizeBytes
  // 19: md5Checksum

  let totalFiles = 0;
  let totalBytes = 0;
  let duplicateCount = 0;
  let duplicateBytes = 0;

  const typeCounts = {};
  const typeBytes = {};
  const md5Map = new Map();

  // Skip header
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const mime = row[4] || 'Unknown';
    const size = Number(row[11]) || 0;
    const md5 = row[19];

    totalFiles++;
    totalBytes += size;

    // Type Stats
    let simpleType = 'Other';
    if (mime.includes('folder')) simpleType = 'Folder';
    else if (mime.includes('image')) simpleType = 'Image';
    else if (mime.includes('video')) simpleType = 'Video';
    else if (mime.includes('pdf')) simpleType = 'PDF';
    else if (mime.includes('google-apps.document')) simpleType = 'Google Doc';
    else if (mime.includes('google-apps.spreadsheet')) simpleType = 'Google Sheet';
    else if (mime.includes('google-apps.presentation')) simpleType = 'Google Slide';

    typeCounts[simpleType] = (typeCounts[simpleType] || 0) + 1;
    typeBytes[simpleType] = (typeBytes[simpleType] || 0) + size;

    // Duplicate Logic (Simple MD5 check on the fly)
    if (md5) {
      if (md5Map.has(md5)) {
        duplicateCount++;
        duplicateBytes += size;
      } else {
        md5Map.set(md5, true);
      }
    }
  }

  // Format for Chart
  const topTypes = Object.keys(typeCounts)
    .map(k => ({ label: k, value: typeCounts[k] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const topStorageTypes = Object.keys(typeBytes)
    .map(k => ({
      label: k,
      value: typeBytes[k],
      displayValue: formatBytes_(typeBytes[k])
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  return {
    totalFiles,
    totalBytes,
    duplicateCount,
    duplicateBytes,
    topTypes,
    topStorageTypes
  };
}

function formatBytes_(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}