import { initI18n, onLanguageChange, t } from '@/lib/i18n';

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';
        let config = {};
        let editingInstance = null;
        let latestInstances = [];
        let datasets = [];
        let datasetsError = null;
        let logsIntervalId = null;
        let activeLogsInstance = null;
        let followLogs = true;
        const LOG_POLL_MS = 2000;
        const SCROLL_THRESHOLD = 40;
        let selectedInstances = new Set();
        const lastHealthByInstance = new Map();
        let lastEnvRule = null;
        let suppressDuplicateDefault = false;

        function showProcessing(text = t('common.processing')) {
            const overlay = document.getElementById('processingOverlay');
            const label = document.getElementById('processingText');
            if (!overlay || !label) return;
            label.textContent = text;
            overlay.style.display = 'flex';
        }

        function hideProcessing() {
            const overlay = document.getElementById('processingOverlay');
            if (!overlay) return;
            overlay.style.display = 'none';
        }

        function updateObbModeOptions() {
            const obbModeSelect = document.getElementById('obbMode');
            if (!obbModeSelect) return;

            const allModes = {
                'rectangle': t('manager.modal.obbModeRectangle'),
                '4point': t('manager.modal.obbMode4Point')
            };

            const availableModes = config.availableObbModes || ['rectangle', '4point'];

            // Clear existing options
            obbModeSelect.innerHTML = '';

            // Add only available modes
            availableModes.forEach(mode => {
                if (allModes[mode]) {
                    const option = document.createElement('option');
                    option.value = mode;
                    option.textContent = allModes[mode];
                    obbModeSelect.appendChild(option);
                }
            });

            // If no valid modes, add rectangle as fallback
            if (obbModeSelect.options.length === 0) {
                const option = document.createElement('option');
                option.value = 'rectangle';
                option.textContent = allModes['rectangle'];
                obbModeSelect.appendChild(option);
            }
        }

        async function loadConfig() {
            try {
                const response = await fetch(`${API_BASE}/api/config`);
                config = await response.json();
                document.getElementById('basePath').textContent = config.datasetBasePath;
                document.getElementById('portRange').textContent = `${config.portRange.start}-${config.portRange.end}`;

                // Filter OBB mode dropdown based on available modes
                updateObbModeOptions();

                await loadDatasets();
            } catch (err) {
                console.error('Failed to load config:', err);
            }
        }

        async function loadDatasets() {
            datasetsError = null;
            try {
                const response = await fetch(`${API_BASE}/api/datasets`);
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || t('manager.folder.failedToLoadDatasets'));
                }
                if (!Array.isArray(data)) {
                    throw new Error(t('manager.folder.invalidDatasetsResponse'));
                }

                datasets = data;
            } catch (err) {
                datasets = [];
                datasetsError = err.message || t('manager.folder.failedToLoadDatasets');
                console.error('Failed to load datasets:', err);
            }
            populateDatasetOptions();
        }

        async function loadClassFiles(datasetFullPath) {
            const basePath = config.datasetBasePath || '/data/datasets';

            try {
                // Find nearest parent folder that contains class files
                const response = await fetch(`${API_BASE}/api/find-class-path?path=${encodeURIComponent(datasetFullPath || basePath)}`);
                const data = await response.json();
                await navigateToClassPath(data.path || '');
            } catch (err) {
                console.error('Failed to load class files:', err);
                // Fallback to root
                await navigateToClassPath('');
            }
        }

        // Current navigation path
        let currentPath = '';

        // Build tree structure from flat dataset list
        function buildDatasetTree() {
            const tree = { folders: new Set(), datasets: new Set() };

            if (!Array.isArray(datasets)) {
                return tree;
            }

            datasets.forEach(d => {
                const parts = d.name.split('/');

                // Add all intermediate folders
                for (let i = 0; i < parts.length; i++) {
                    const folderPath = parts.slice(0, i + 1).join('/');
                    const parentPath = i === 0 ? '' : parts.slice(0, i).join('/');

                    if (!tree[parentPath]) {
                        tree[parentPath] = { folders: new Set(), datasets: new Set() };
                    }

                    if (i === parts.length - 1) {
                        // This is a dataset
                        tree[parentPath].datasets.add({ name: parts[i], path: d.path, imageCount: d.imageCount || 0 });
                    } else {
                        // This is a folder
                        tree[parentPath].folders.add(parts[i]);
                    }
                }
            });

            return tree;
        }

        function populateDatasetOptions() {
            window.datasetTree = buildDatasetTree();
            navigateToPath('');
        }

        function getMatchingDuplicateRule(datasetPath) {
            const rules = config.duplicateRules || [];
            const defaultAction = config.duplicateDefaultAction || 'move';

            if (!datasetPath) {
                return { action: defaultAction, labels: 0, matchedPattern: null };
            }

            const matchingRules = [];
            const pathLower = datasetPath.toLowerCase();

            for (const rule of rules) {
                const pattern = rule.pattern || '';
                if (pattern && pathLower.includes(pattern.toLowerCase())) {
                    matchingRules.push(rule);
                }
            }

            if (matchingRules.length === 0) {
                return { action: defaultAction, labels: 0, matchedPattern: null };
            }

            matchingRules.sort((a, b) => (a.priority || 999) - (b.priority || 999));
            const winner = matchingRules[0];

            return {
                action: winner.action || defaultAction,
                labels: winner.labels || 0,
                matchedPattern: winner.pattern
            };
        }

        function fetchDuplicateRule(datasetPath, setDefault = false) {
            const infoEl = document.getElementById('duplicateModeEnvInfo');
            const actionEl = document.getElementById('duplicateModeAction');
            const labelsEl = document.getElementById('duplicateModeLabels');
            const patternEl = document.getElementById('duplicateModePattern');

            if (!infoEl || !actionEl || !labelsEl || !patternEl) return;

            if (!datasetPath) {
                infoEl.style.display = 'none';
                return;
            }

            const rule = getMatchingDuplicateRule(datasetPath);
            lastEnvRule = rule;

            // Show the info box
            infoEl.style.display = 'flex';

            // Set action with appropriate styling
            const actionKey = `manager.modal.duplicateMode${rule.action.charAt(0).toUpperCase() + rule.action.slice(1)}`;
            actionEl.textContent = t(actionKey) || rule.action;
            actionEl.className = `duplicate-mode-action action-${rule.action}`;

            // Set labels info
            if (rule.labels === 0) {
                labelsEl.textContent = `(${t('manager.modal.duplicateLabels')}: ${t('manager.modal.duplicateLabelsAll')})`;
            } else {
                labelsEl.textContent = `(${t('manager.modal.duplicateLabels')}: ${rule.labels})`;
            }

            // Set matched pattern if any
            if (rule.matchedPattern) {
                patternEl.textContent = t('manager.modal.duplicateMatchedPattern', { pattern: rule.matchedPattern });
                patternEl.style.display = 'inline';
            } else {
                patternEl.textContent = `(${t('manager.modal.duplicateModeDefault')})`;
                patternEl.style.display = 'inline';
            }

            // Mark the .env default option in the dropdown
            const modeSelect = document.getElementById('duplicateMode');
            if (modeSelect) {
                const envValue = rule.action === 'skip' ? 'none' : rule.action;
                for (const opt of modeSelect.options) {
                    const baseKey = `manager.modal.duplicateMode${opt.value.charAt(0).toUpperCase() + opt.value.slice(1)}`;
                    opt.textContent = opt.value === envValue
                        ? `${t(baseKey)} (${t('manager.modal.duplicateModeDefault')})`
                        : t(baseKey);
                }
                if (setDefault && !suppressDuplicateDefault) {
                    modeSelect.value = envValue;
                    updateDuplicateModeDisplay();
                }
            }
        }

        function updateDuplicateModeDisplay() {
            const infoEl = document.getElementById('duplicateModeEnvInfo');
            const actionEl = document.getElementById('duplicateModeAction');
            const labelsEl = document.getElementById('duplicateModeLabels');
            const patternEl = document.getElementById('duplicateModePattern');
            const modeSelect = document.getElementById('duplicateMode');

            if (!infoEl || !actionEl || !modeSelect) return;

            const mode = modeSelect.value;
            const thresholdInput = document.getElementById('threshold');
            if (thresholdInput) {
                thresholdInput.disabled = mode === 'none';
            }

            if (!mode) {
                infoEl.style.display = 'none';
                return;
            }

            infoEl.style.display = 'flex';

            // Map dropdown value to display action ('none' displays as 'skip')
            const displayAction = mode === 'none' ? 'skip' : mode;
            const actionKey = `manager.modal.duplicateMode${displayAction.charAt(0).toUpperCase() + displayAction.slice(1)}`;
            actionEl.textContent = t(actionKey) || displayAction;
            actionEl.className = `duplicate-mode-action action-${displayAction}`;

            // If selection matches the .env rule, restore full .env details
            const envAction = lastEnvRule ? (lastEnvRule.action === 'skip' ? 'none' : lastEnvRule.action) : null;
            if (lastEnvRule && mode === envAction) {
                if (labelsEl) {
                    labelsEl.textContent = lastEnvRule.labels === 0
                        ? `(${t('manager.modal.duplicateLabels')}: ${t('manager.modal.duplicateLabelsAll')})`
                        : `(${t('manager.modal.duplicateLabels')}: ${lastEnvRule.labels})`;
                }
                if (patternEl) {
                    patternEl.textContent = lastEnvRule.matchedPattern
                        ? t('manager.modal.duplicateMatchedPattern', { pattern: lastEnvRule.matchedPattern })
                        : `(${t('manager.modal.duplicateModeDefault')})`;
                    patternEl.style.display = 'inline';
                }
            } else {
                if (labelsEl) labelsEl.textContent = '';
                if (patternEl) {
                    patternEl.textContent = '';
                    patternEl.style.display = 'none';
                }
            }
        }

        async function isDatasetFolder(fullPath) {
            // Check if a folder only contains "images" and/or "labels" subfolders via API
            try {
                const response = await fetch(`/api/browse-path?path=${encodeURIComponent(fullPath)}`);
                if (!response.ok) return false;

                const data = await response.json();
                const folders = data.folders || [];

                // If there are no subfolders at all, not a dataset folder
                if (folders.length === 0) return false;

                // A dataset folder must contain "images" and "labels",
                // and have no other subfolders to navigate into (besides duplicate)
                const datasetInternalDirs = new Set(['images', 'labels', 'duplicate']);
                const navigableFolders = folders.filter(f => !datasetInternalDirs.has(f));
                return folders.includes('images') && folders.includes('labels') && navigableFolders.length === 0;
            } catch (err) {
                return false;
            }
        }

        function navigateToPath(path, updatePathField = true) {
            const basePath = config.datasetBasePath || '/data/datasets';
            const fullPath = path ? `${basePath}/${path}` : basePath;

            // Clear search filter on navigation
            const searchInput = document.getElementById('folderSearch');
            if (searchInput) searchInput.value = '';

            // Update datasetPath first so renderFolderList shows the correct highlight
            if (updatePathField) {
                document.getElementById('datasetPath').value = fullPath;
            }

            // Check if this folder has child datasets in the tree
            const treeEntry = (window.datasetTree && window.datasetTree[path]) || { folders: new Set(), datasets: new Set() };
            const hasChildren = treeEntry.folders.size > 0 || treeEntry.datasets.size > 0;

            if (hasChildren) {
                // Navigate into the folder
                currentPath = path;
                renderBreadcrumb(path);
                renderFolderList(path);
            } else {
                // Leaf dataset — select it but stay at the current level
                renderFolderList(currentPath);
            }

            if (!updatePathField) return;
            fetchDuplicateRule(fullPath, true);

            const instanceNameField = document.getElementById('instanceName');
            if (instanceNameField && !instanceNameField.disabled) {
                if (path) {
                    const pathParts = path.split('/').filter(p => p);
                    if (pathParts.length > 0) {
                        instanceNameField.value = pathParts[pathParts.length - 1];
                        validateInstanceName();
                    }
                } else {
                    instanceNameField.value = '';
                    hideInstanceNameError();
                }
            }

            const classFileInput = document.getElementById('classFile');
            if (!classFileInput || !classFileInput.value) {
                loadClassFiles(fullPath || config.datasetBasePath);
            }
        }

        function renderBreadcrumb(path) {
            const breadcrumb = document.getElementById('breadcrumb');
            if (!breadcrumb) return;

            const parts = path ? path.split('/') : [];
            let html = `<span class="crumb" onclick="navigateToPath('')">📁 ${t('manager.folder.datasets')}</span>`;

            if (parts.length > 0 && parts[0] !== '') {
                html += '<span class="crumb-sep">/</span>';
                parts.forEach((part, index) => {
                    const pathToHere = parts.slice(0, index + 1).join('/');
                    html += `<span class="crumb" onclick="navigateToPath('${pathToHere}')">${part}</span>`;
                    if (index < parts.length - 1) {
                        html += '<span class="crumb-sep">/</span>';
                    }
                });
            }

            // Add refresh button
            html += `<button type="button" class="btn-refresh" onclick="refreshAndStay()" title="${t('manager.folder.refreshFolders')}">↻</button>`;

            breadcrumb.innerHTML = html;
        }

        function renderFolderList(path) {
            const folderList = document.getElementById('folderList');
            if (!folderList || !window.datasetTree) return;

            const currentLevel = window.datasetTree[path] || { folders: new Set(), datasets: new Set() };
            let html = '';

            if (datasetsError) {
                folderList.innerHTML = `<div class="folder-item empty">${t('manager.folder.errorLoading')}: ${datasetsError}</div>`;
                return;
            }

            // Show all folders (including those that are datasets)
            const allItems = new Map();

            // Add datasets first (they take priority — show imageCount)
            Array.from(currentLevel.datasets).forEach(dataset => {
                const folderPath = path ? `${path}/${dataset.name}` : dataset.name;
                allItems.set(dataset.name, { name: dataset.name, path: folderPath, imageCount: dataset.imageCount });
            });

            // Add folders; if already a dataset, mark hasChildren; otherwise add with datasetCount
            Array.from(currentLevel.folders).forEach(folder => {
                const folderPath = path ? `${path}/${folder}` : folder;
                if (allItems.has(folder)) {
                    // This item is both a dataset and has child datasets — mark as navigable
                    allItems.get(folder).hasChildren = true;
                } else {
                    // Intermediate folder — count child datasets, excluding 'duplicate' entries
                    const datasetCount = datasets.filter(d => {
                        if (d.name.split('/').pop() === 'duplicate') return false;
                        return d.name === folderPath || d.name.startsWith(folderPath + '/');
                    }).length;
                    allItems.set(folder, { name: folder, path: folderPath, datasetCount });
                }
            });

            // Sort and filter items
            let sortedItems = Array.from(allItems.values()).sort((a, b) => a.name.localeCompare(b.name));

            const searchInput = document.getElementById('folderSearch');
            const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
            if (searchTerm) {
                sortedItems = sortedItems.filter(item => item.name.toLowerCase().includes(searchTerm));
            }

            // Get current selected path for highlighting
            const datasetPathInput = document.getElementById('datasetPath');
            const selectedFullPath = datasetPathInput ? datasetPathInput.value : '';
            const basePath = config.datasetBasePath || '/data/datasets';
            let selectedRelativePath = selectedFullPath;
            if (selectedRelativePath.startsWith(basePath)) {
                selectedRelativePath = selectedRelativePath.slice(basePath.length).replace(/^\//, '');
            }

            sortedItems.forEach(item => {
                const isSelected = item.path === selectedRelativePath;
                let countBadge = '';
                if (item.imageCount !== undefined) {
                    countBadge = `<span class="folder-count">${item.imageCount.toLocaleString()} imgs</span>`;
                } else if (item.datasetCount !== undefined && item.datasetCount > 0) {
                    countBadge = `<span class="folder-count">${item.datasetCount} dataset${item.datasetCount !== 1 ? 's' : ''}</span>`;
                }
                html += `
                    <div class="folder-item${isSelected ? ' selected' : ''}" onclick="navigateToPath('${item.path}')">
                        <div class="folder-name">${item.name}</div>
                        ${countBadge}
                    </div>
                `;
            });

            if (html === '') {
                html = `<div class="folder-item empty">${t('manager.folder.noFolders')}</div>`;
            }

            folderList.innerHTML = html;
        }

        function filterFolderList() {
            const btn = document.getElementById('folderSearchClear');
            const input = document.getElementById('folderSearch');
            if (btn) btn.style.display = input && input.value ? 'block' : 'none';
            renderFolderList(currentPath);
        }

        function clearFolderSearch() {
            const input = document.getElementById('folderSearch');
            if (input) input.value = '';
            filterFolderList();
        }

        function filterClassFolderList() {
            const btn = document.getElementById('classFolderSearchClear');
            const input = document.getElementById('classFolderSearch');
            if (btn) btn.style.display = input && input.value ? 'block' : 'none';
            renderClassFolderList(currentClassPath);
        }

        function clearClassFolderSearch() {
            const input = document.getElementById('classFolderSearch');
            if (input) input.value = '';
            filterClassFolderList();
        }

        async function refreshDatasetOptions() {
            await loadDatasets();
        }

        async function refreshAndStay() {
            const previousPath = currentPath;
            await loadDatasets();
            // Return to the same path after refresh
            navigateToPath(previousPath);
        }

        // Current class file navigation path
        let currentClassPath = '';

        async function navigateToClassPath(path) {
            currentClassPath = path;
            if (typeof window !== 'undefined') {
                window.currentClassPath = currentClassPath;
            }
            const classSearchInput = document.getElementById('classFolderSearch');
            if (classSearchInput) classSearchInput.value = '';
            await renderClassBreadcrumb(path);
            await renderClassFolderList(path);
        }

        function renderClassBreadcrumb(path) {
            const breadcrumb = document.getElementById('classBreadcrumb');
            if (!breadcrumb) return;

            const parts = path ? path.split('/').filter(p => p) : [];
            let html = `<span class="crumb" onclick="navigateToClassPath('')">📁 ${t('manager.folder.datasets')}</span>`;

            if (parts.length > 0) {
                html += '<span class="crumb-sep">/</span>';
                parts.forEach((part, index) => {
                    const pathToHere = parts.slice(0, index + 1).join('/');
                    html += `<span class="crumb" onclick="navigateToClassPath('${pathToHere}')">${part}</span>`;
                    if (index < parts.length - 1) {
                        html += '<span class="crumb-sep">/</span>';
                    }
                });
            }

            // Add refresh button
            html += `<button type="button" class="btn-refresh" onclick="navigateToClassPath(currentClassPath)" title="${t('manager.folder.refreshFolders')}">↻</button>`;

            breadcrumb.innerHTML = html;
        }

        async function renderClassFolderList(path) {
            const folderList = document.getElementById('classFolderList');
            if (!folderList) return;

            try {
                // Build full path from base path
                const basePath = config.datasetBasePath || '/data/datasets';
                const fullPath = path ? `${basePath}/${path}` : basePath;

                const response = await fetch(`${API_BASE}/api/browse-path?path=${encodeURIComponent(fullPath)}&filterClassFiles=true`);
                const data = await response.json();

                let html = '';

                // Apply search filter
                const classSearchInput = document.getElementById('classFolderSearch');
                const classSearchTerm = classSearchInput ? classSearchInput.value.trim().toLowerCase() : '';

                // Show folders first
                let folders = data.folders || [];
                let files = data.files || [];
                if (classSearchTerm) {
                    folders = folders.filter(f => f.toLowerCase().includes(classSearchTerm));
                    files = files.filter(f => f.toLowerCase().includes(classSearchTerm));
                }

                if (folders.length > 0) {
                    folders.forEach(folder => {
                        const folderPath = path ? `${path}/${folder}` : folder;
                        html += `
                            <div class="folder-item" onclick="navigateToClassPath('${folderPath}')">
                                <div class="folder-name">${folder}</div>
                            </div>
                        `;
                    });
                }

                // Show .txt files containing "class"
                if (files.length > 0) {
                    files.forEach(file => {
                        if (file.toLowerCase().endsWith('.txt') && file.toLowerCase().includes('class')) {
                            const filePath = path ? `${path}/${file}` : file;
                            const absolutePath = path ? `${basePath}/${filePath}` : `${basePath}/${file}`;
                            html += `
                                <div class="folder-item file-item" onclick="selectClassFile('${absolutePath}')">
                                    <div class="folder-name file-name">${file}</div>
                                </div>
                            `;
                        }
                    });
                }

                if (html === '') {
                    html = `<div class="folder-item empty">${t('manager.folder.noFoldersOrClassFiles')}</div>`;
                }

                folderList.innerHTML = html;
            } catch (err) {
                console.error('Failed to load path:', err);
                folderList.innerHTML = `<div class="folder-item empty">${t('manager.folder.errorLoading')}</div>`;
            }
        }

        function hideClassPreview() {
            const container = document.getElementById('classPreview');
            const body = document.getElementById('classPreviewBody');
            const meta = document.getElementById('classPreviewMeta');
            const note = document.getElementById('classPreviewNote');
            const error = document.getElementById('classPreviewError');
            if (!container || !body || !meta) return;
            container.style.display = 'none';
            body.textContent = t('manager.modal.selectClassFile');
            meta.textContent = '';
            if (note) note.style.display = 'none';
            if (error) error.style.display = 'none';
        }

        async function previewClassFile(path) {
            const container = document.getElementById('classPreview');
            const body = document.getElementById('classPreviewBody');
            const meta = document.getElementById('classPreviewMeta');
            const note = document.getElementById('classPreviewNote');
            const error = document.getElementById('classPreviewError');
            if (!container || !body || !meta) return;

            if (!path) {
                hideClassPreview();
                return;
            }

            container.style.display = 'block';
            body.textContent = t('manager.modal.loadingPreview');
            meta.textContent = '';
            if (note) note.style.display = 'none';
            if (error) {
                error.style.display = 'none';
                error.textContent = '';
            }

            try {
                const response = await fetch(`${API_BASE}/api/class-file?path=${encodeURIComponent(path)}`);
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || t('manager.modal.failedToLoadClassFile'));
                }

                const lines = (data.content || '')
                    .split(/\r?\n/)
                    .filter(line => line.trim() !== '');

                body.textContent = lines.length ? lines.join('\n') : t('manager.modal.fileEmpty');

                const lineCount = lines.length;
                meta.textContent = `${lineCount} ${t('manager.modal.lines')}`;

                if (note) {
                    if (data.truncated) {
                        note.textContent = t('manager.modal.previewTruncated');
                        note.style.display = 'block';
                    } else {
                        note.style.display = 'none';
                    }
                }
            } catch (err) {
                body.textContent = '';
                meta.textContent = '';
                if (error) {
                    error.textContent = err.message || t('manager.modal.unableToPreview');
                    error.style.display = 'block';
                }
            }
        }

        function selectClassFile(path) {
            document.getElementById('classFile').value = path;
            previewClassFile(path);
        }

        async function loadInstances() {
            try {
                const response = await fetch(`${API_BASE}/api/instances`);
                const instances = await response.json();
                latestInstances = instances;

                // Clean up selectedInstances - remove any instances that no longer exist
                const instanceNames = new Set(instances.map(i => i.name));
                for (const name of selectedInstances) {
                    if (!instanceNames.has(name)) {
                        selectedInstances.delete(name);
                    }
                }

                // Auto-open when service goes from down -> up
                instances.forEach(instance => {
                    const name = instance.name || '';
                    const health = (instance.serviceHealth || '').toLowerCase();
                    const prevHealth = lastHealthByInstance.get(name);
                    if (instance.status === 'online' && health === 'healthy' && prevHealth === 'unhealthy') {
                        openInstance(instance.port);
                    }
                    lastHealthByInstance.set(name, health || 'n/a');
                });

                for (const name of Array.from(lastHealthByInstance.keys())) {
                    if (!instanceNames.has(name)) {
                        lastHealthByInstance.delete(name);
                    }
                }

                renderInstances(instances);
                updateSelectionButtons();
            } catch (err) {
                console.error('Failed to load instances:', err);
            }
        }

        function statusMeta(instance) {
            const status = (instance.status || 'unknown').toLowerCase();
            if (status === 'online') return { cls: 'status-online', text: t('manager.status.running') };
            if (status === 'stopped') return { cls: 'status-stopped', text: t('manager.status.notRunning') };
            return { cls: 'status-unknown', text: t('manager.status.unknown') };
        }

        function healthMeta(instance) {
            const health = (instance.serviceHealth || 'n/a').toLowerCase();
            if (health === 'healthy') return { cls: 'health-healthy', text: t('manager.status.serviceOk') };
            if (health === 'unhealthy') return { cls: 'health-unhealthy', text: t('manager.status.serviceDown') };
            return { cls: 'health-na', text: t('manager.status.na') };
        }

        function renderInstances(instances) {
            const container = document.getElementById('instancesContainer');
            const selectAllCheckbox = document.getElementById('selectAllCheckbox');

            // Show/hide select all checkbox based on instance count
            if (selectAllCheckbox) {
                selectAllCheckbox.style.display = instances.length > 0 ? 'inline-block' : 'none';
            }

            if (!instances.length) {
                container.innerHTML = `
                    <div class="empty-state">
                        <h2>${t('manager.noInstances')}</h2>
                        <p>${t('manager.noInstancesHint')}</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = instances.map(instance => {
                const meta = statusMeta(instance);
                const health = healthMeta(instance);
                const hasError = instance.status && instance.status.toLowerCase() === 'error';
                const serviceDown = (instance.serviceHealth || '').toLowerCase() === 'unhealthy';
                return `
                <div class="instance-card">
                    <div class="instance-header">
                        <div class="instance-id">
                            <input type="checkbox"
                                   class="instance-select-checkbox"
                                   id="checkbox-${instance.name}"
                                   onchange="toggleInstanceSelection('${instance.name}')"
                                   ${selectedInstances.has(instance.name) ? 'checked' : ''}>
                            <span>${instance.name || t('manager.instanceFallback')}</span>
                        </div>
                        <div class="status-group">
                            <div class="status-pill ${hasError ? 'status-error' : meta.cls}">
                                <span class="dot"></span>
                                <span>${hasError ? t('manager.status.error') : meta.text}</span>
                            </div>
                            ${instance.status === 'online' ? `
                            <div class="status-pill ${health.cls}">
                                <span class="dot"></span>
                                <span>${health.text}</span>
                            </div>
                            ` : ''}
                        </div>
                    </div>

                    ${hasError ? `<div class="status-message">${t('manager.hint.lastErrorReported')}</div>` : ''}

                    <div class="instance-grid">
                        <div class="field">
                            <label>${t('common.name')}</label>
                            <input type="text" value="${instance.name || ''}" readonly>
                        </div>
                        <div class="field">
                            <label>${t('common.port')}</label>
                            <input type="text" value="${instance.port || ''}" readonly>
                        </div>
                        <div class="field" style="grid-column: span 2;">
                            <label>${t('manager.modal.datasetPath')}</label>
                            <input type="text" value="${instance.datasetPath || ''}" readonly>
                        </div>
                    </div>
                    <div class="hint">${t('manager.hint.mustBeInsideBasePath')}</div>
                    <div class="instance-actions">
                        ${instance.status === 'online'
                            ? `<button class="btn secondary" onclick="restartInstance('${instance.name}')">${t('common.restart')}</button>
                               <button class="btn danger" onclick="stopInstance('${instance.name}')">${t('common.stop')}</button>
                               <button class="btn secondary" onclick="openInstance(${instance.port})" ${serviceDown ? `disabled title="${t('manager.hint.serviceDown')}"` : ''}>${t('common.open')}</button>
                               <button class="btn secondary" onclick="openLabelEditor('${encodeURIComponent(instance.name)}')" ${instance.datasetPath ? '' : `disabled title="${t('manager.hint.datasetPathRequired')}"`}>${t('manager.openEditor')}</button>`
                            : `<button class="btn success" onclick="startInstance('${instance.name}')">${t('common.start')}</button>
                               <button class="btn ghost" onclick="editInstance('${instance.name}')">${t('common.edit')}</button>
                               <button class="btn danger" onclick="deleteInstance('${instance.name}')">${t('common.remove')}</button>
                               <button class="btn secondary" onclick="openLabelEditor('${encodeURIComponent(instance.name)}')" ${instance.datasetPath ? '' : `disabled title="${t('manager.hint.datasetPathRequired')}"`}>${t('manager.openEditor')}</button>`
                        }
                        <button class="btn ghost" onclick="showLogs('${instance.name}')">${t('manager.logs')}</button>
                    </div>
                </div>
                `;
            }).join('');
        }

        async function startInstance(name) {
            showProcessing(t('manager.processing.starting', { name }));
            try {
                const response = await fetch(`${API_BASE}/api/instances/${name}/start`, { method: 'POST' });
                if (!response.ok) {
                    const error = await response.json();
                    alert(`${t('manager.errors.failedToStart')}: ${error.error}`);
                    return;
                }
                setTimeout(refreshInstances, 800);
            } catch (err) {
                alert(`${t('manager.errors.failedToStart')}: ${err.message}`);
            } finally {
                hideProcessing();
            }
        }

        async function stopInstance(name) {
            showProcessing(t('manager.processing.stopping', { name }));
            try {
                const response = await fetch(`${API_BASE}/api/instances/${name}/stop`, { method: 'POST' });
                if (!response.ok) {
                    const error = await response.json();
                    alert(`${t('manager.errors.failedToStop')}: ${error.error}`);
                    return;
                }
                setTimeout(refreshInstances, 800);
            } catch (err) {
                alert(`${t('manager.errors.failedToStop')}: ${err.message}`);
            } finally {
                hideProcessing();
            }
        }

        async function restartInstance(name) {
            try {
                const response = await fetch(`${API_BASE}/api/instances/${name}/restart`, { method: 'POST' });
                if (!response.ok) {
                    const error = await response.json();
                    alert(`${t('manager.errors.failedToRestart')}: ${error.error}`);
                    return;
                }
                setTimeout(refreshInstances, 800);
            } catch (err) {
                alert(`${t('manager.errors.failedToRestart')}: ${err.message}`);
            }
        }

        function toggleInstanceSelection(name) {
            if (selectedInstances.has(name)) {
                selectedInstances.delete(name);
            } else {
                selectedInstances.add(name);
            }
            updateSelectionButtons();
        }

        function toggleSelectAll() {
            const selectAllCheckbox = document.getElementById('selectAllCheckbox');
            if (!selectAllCheckbox) return;

            if (selectAllCheckbox.checked) {
                // Select all instances
                latestInstances.forEach(instance => {
                    selectedInstances.add(instance.name);
                });
            } else {
                // Deselect all instances
                selectedInstances.clear();
            }

            // Re-render to update individual checkboxes
            renderInstances(latestInstances);
            updateSelectionButtons();
        }

        function updateSelectionButtons() {
            const hasSelection = selectedInstances.size > 0;
            const startBtn = document.getElementById('startSelectedBtn');
            const stopBtn = document.getElementById('stopSelectedBtn');
            const removeBtn = document.getElementById('removeSelectedBtn');

            if (startBtn) {
                startBtn.disabled = !hasSelection;
                startBtn.title = hasSelection ? t('manager.hint.startSelected') : t('manager.hint.selectInstancesToStart');
            }
            if (stopBtn) {
                stopBtn.disabled = !hasSelection;
                stopBtn.title = hasSelection ? t('manager.hint.stopSelected') : t('manager.hint.selectInstancesToStop');
            }

            // Check if any selected instances are running
            if (removeBtn) {
                const selectedArray = Array.from(selectedInstances);
                const hasRunningInstances = selectedArray.some(name => {
                    const instance = latestInstances.find(i => i.name === name);
                    return instance && instance.status === 'online';
                });

                if (!hasSelection) {
                    removeBtn.disabled = true;
                    removeBtn.title = t('manager.hint.selectInstancesToRemove');
                } else if (hasRunningInstances) {
                    removeBtn.disabled = true;
                    removeBtn.title = t('manager.hint.cannotRemoveRunning');
                } else {
                    removeBtn.disabled = false;
                    removeBtn.title = t('manager.hint.removeSelected');
                }
            }

            // Update select all checkbox state
            const selectAllCheckbox = document.getElementById('selectAllCheckbox');
            if (selectAllCheckbox) {
                if (latestInstances.length > 0) {
                    const allSelected = latestInstances.every(instance => selectedInstances.has(instance.name));
                    const someSelected = selectedInstances.size > 0;
                    selectAllCheckbox.checked = allSelected;
                    selectAllCheckbox.indeterminate = someSelected && !allSelected;
                } else {
                    selectAllCheckbox.checked = false;
                    selectAllCheckbox.indeterminate = false;
                }
            }
        }

        async function startSelectedInstances() {
            if (selectedInstances.size === 0) return;
            const selected = Array.from(selectedInstances);
            for (const name of selected) {
                const instance = latestInstances.find(i => i.name === name);
                if (instance && instance.status !== 'online') {
                    await startInstance(name);
                }
            }
            refreshInstances();
        }

        async function stopSelectedInstances() {
            if (selectedInstances.size === 0) return;
            const selected = Array.from(selectedInstances);
            for (const name of selected) {
                const instance = latestInstances.find(i => i.name === name);
                if (instance && instance.status === 'online') {
                    await stopInstance(name);
                }
            }
            refreshInstances();
        }

        async function removeSelectedInstances() {
            if (selectedInstances.size === 0) return;

            const count = selectedInstances.size;
            if (!confirm(t('manager.confirm.deleteMultiple', { count }))) {
                return;
            }

            const selected = Array.from(selectedInstances);
            for (const name of selected) {
                await deleteInstance(name, true);
            }
            updateSelectionButtons();
            refreshInstances();
        }

        async function deleteInstance(name, skipConfirm = false) {
            if (!skipConfirm && !confirm(t('manager.confirm.deleteInstance', { name }))) {
                return;
            }
            try {
                const response = await fetch(`${API_BASE}/api/instances/${name}`, { method: 'DELETE' });
                if (!response.ok) {
                    const error = await response.json();
                    alert(`${t('manager.errors.failedToDelete')}: ${error.error}`);
                    return;
                }
                selectedInstances.delete(name);
                if (!skipConfirm) {
                    refreshInstances();
                }
            } catch (err) {
                alert(`${t('manager.errors.failedToDelete')}: ${err.message}`);
            }
        }

        function openInstance(port) {
            window.open(`http://${window.location.hostname}:${port}`, '_blank');
        }

        async function openLabelEditor(encodedInstanceName) {
            const instanceName = decodeURIComponent(encodedInstanceName || '');
            if (!instanceName) {
                alert(t('manager.errors.datasetPathMissing'));
                return;
            }
            const editorUrl = `${window.location.origin}/label-editor?instance=${encodeURIComponent(instanceName)}`;
            window.open(editorUrl, '_blank');
        }

        function normalizeStartImagePath(lastImagePath, folderPath) {
            if (!lastImagePath) {
                return '';
            }
            if (lastImagePath.startsWith(`${folderPath}/`)) {
                return lastImagePath;
            }
            if (lastImagePath.startsWith('images/') && folderPath.endsWith('/images') && folderPath !== 'images') {
                const datasetPrefix = folderPath.replace(/\/images$/, '');
                return `${datasetPrefix}/${lastImagePath}`;
            }
            return lastImagePath;
        }

        function openLabelEditorMain() {
            window.open(`${window.location.origin}/label-editor-main.html`, '_blank');
        }

        function findSmallestAvailablePort() {
            const usedPorts = new Set(latestInstances.map(i => i.port));
            for (let port = config.portRange.start; port <= config.portRange.end; port++) {
                if (!usedPorts.has(port)) {
                    return port;
                }
            }
            return config.portRange.start; // Fallback to start if all ports are used
        }

        function populatePortOptions(excludeInstance = null) {
            const portSelect = document.getElementById('instancePort');
            if (!portSelect) {
                console.error('Port select element not found');
                return;
            }

            if (!config.portRange) {
                console.error('Config port range not loaded', config);
                return;
            }

            const usedPorts = new Set(
                latestInstances
                    .filter(i => i.name !== excludeInstance)
                    .map(i => i.port)
            );

            console.log('Populating port options:', {
                portRange: config.portRange,
                usedPorts: Array.from(usedPorts),
                latestInstances: latestInstances.length
            });

            const ports = [];
            for (let port = config.portRange.start; port <= config.portRange.end; port++) {
                const isAvailable = !usedPorts.has(port);
                ports.push({
                    value: port,
                    label: isAvailable
                        ? `${port} (${t('common.available')})`
                        : `${port} (${t('common.inUse')})`,
                    available: isAvailable,
                    display: true
                });
            }

            console.log('Generated ports:', ports);

            // Store all ports for filtering
            portSelect._allPorts = ports;
            renderPortOptions(ports);
        }

        function renderPortOptions(ports) {
            const portSelect = document.getElementById('instancePort');
            if (!portSelect) return;

            // Get currently selected value
            const currentValue = portSelect.value;

            portSelect.innerHTML = ports
                .filter(p => p.display)
                .map(p => `<option value="${p.value}" class="${p.available ? 'available' : 'used'}" ${!p.available ? 'disabled' : ''}>${p.label}</option>`)
                .join('');

            // Restore selection if it's still available
            if (currentValue && ports.find(p => p.value == currentValue && p.display)) {
                portSelect.value = currentValue;
            }
        }

        function updateSelectedPortDisplay() {
            const portSelect = document.getElementById('instancePort');
            const displayInput = document.getElementById('selectedPortDisplay');
            if (!portSelect || !displayInput) return;

            const selectedPort = portSelect.value;
            if (selectedPort) {
                displayInput.value = selectedPort;
            } else {
                displayInput.value = '';
            }
        }

        async function showAddModal() {
            console.log('showAddModal: Starting...');

            // Ensure config is loaded
            if (!config.portRange) {
                console.log('showAddModal: Loading config...');
                await loadConfig();
            }
            console.log('showAddModal: Config loaded', config);

            // Ensure instances are loaded for port availability check
            // Always refresh to get latest state
            console.log('showAddModal: Loading instances...');
            await loadInstances();
            console.log('showAddModal: Instances loaded', latestInstances);

            editingInstance = null;
            document.getElementById('modalTitle').textContent = t('manager.modal.addTitle');
            document.getElementById('instanceForm').reset();
            document.getElementById('threshold').value = config.defaultIouThreshold;
            document.getElementById('threshold').disabled = false;
            document.getElementById('autoSync').checked = true;
            document.getElementById('pentagonFormat').checked = false;
            document.getElementById('obbMode').value = 'rectangle';
            document.getElementById('obbModeGroup').style.display = 'none'; // Hide OBB mode by default
            document.getElementById('instanceName').disabled = false;
            hideInstanceNameError();
            document.getElementById('modalError').style.display = 'none';
            document.getElementById('instanceModal').classList.add('active');
            hideClassPreview();
            // Reset duplicate mode dropdown (will be set from .env when path is selected)
            document.getElementById('duplicateMode').value = 'move';
            const duplicateModeEnvInfo = document.getElementById('duplicateModeEnvInfo');
            if (duplicateModeEnvInfo) duplicateModeEnvInfo.style.display = 'none';
            populateDatasetOptions();

            // Initialize class file browser
            await navigateToClassPath('');

            // Populate port dropdown and select smallest available port
            console.log('showAddModal: Populating port options...');
            populatePortOptions();
            const defaultPort = findSmallestAvailablePort();
            console.log('showAddModal: Default port selected:', defaultPort);
            document.getElementById('instancePort').value = defaultPort;
            updateSelectedPortDisplay();
            console.log('showAddModal: Complete');
        }

        async function editInstance(name) {
            try {
                // Ensure config is loaded
                if (!config.portRange) {
                    await loadConfig();
                }

                // Ensure instances are loaded
                await loadInstances();

                const instance = latestInstances.find(i => i.name === name);
                if (!instance) {
                    alert(t('manager.errors.instanceNotFound'));
                    return;
                }

                editingInstance = name;
                document.getElementById('modalTitle').textContent = t('manager.modal.editTitle');
                document.getElementById('instanceName').value = instance.name;
                document.getElementById('instanceName').disabled = false;
                document.getElementById('threshold').value = instance.threshold;
                document.getElementById('autoSync').checked = instance.autoSync || false;
                document.getElementById('pentagonFormat').checked = instance.pentagonFormat || false;
                document.getElementById('obbMode').value = instance.obbMode || 'rectangle';
                document.getElementById('classFile').value = instance.classFile || '';

                // Show/hide OBB mode dropdown based on pentagonFormat
                document.getElementById('obbModeGroup').style.display = instance.pentagonFormat ? 'block' : 'none';

                hideInstanceNameError();
                document.getElementById('modalError').style.display = 'none';
                document.getElementById('instanceModal').classList.add('active');

                // Check dataset format and auto-check if already in OBB format
                checkAndUpdatePentagonFormat(name);
                if (instance.classFile) {
                    previewClassFile(instance.classFile);
                } else {
                    hideClassPreview();
                }

                // Suppress async fetchDuplicateRule from overriding stored mode during edit setup
                suppressDuplicateDefault = true;

                // Populate dataset options first (this will reset the path)
                populateDatasetOptions();

                // IMPORTANT: Set the dataset path AFTER populateDatasetOptions()
                // to prevent it from being overwritten by the base directory
                document.getElementById('datasetPath').value = instance.datasetPath;
                // Keep current instance name until user chooses a different dataset folder.
                document.getElementById('instanceName').value = instance.name;

                // Initialize class file browser - navigate to parent folder if classFile exists
                if (instance.classFile) {
                    const basePath = config.datasetBasePath || '/data/datasets';
                    // Remove base path to get relative path
                    const relativePath = instance.classFile.replace(basePath + '/', '');
                    const classDir = relativePath.substring(0, relativePath.lastIndexOf('/'));
                    if (classDir) {
                        await navigateToClassPath(classDir);
                    } else {
                        await navigateToClassPath('');
                    }
                } else {
                    await navigateToClassPath('');
                }

                // Navigate to the parent folder of the selected dataset
                // But don't update the path field - preserve the existing instance path
                if (instance.datasetPath) {
                    const basePath = config.datasetBasePath || '/data/datasets';
                    // Get relative path from datasetPath
                    let relativePath = instance.datasetPath;
                    if (relativePath.startsWith(basePath)) {
                        relativePath = relativePath.slice(basePath.length).replace(/^\//, '');
                    }

                    // Navigate to parent folder
                    const parts = relativePath.split('/').filter(p => p);
                    if (parts.length > 1) {
                        const parentPath = parts.slice(0, -1).join('/');
                        currentPath = parentPath; // Set directly to avoid async issues
                        renderBreadcrumb(parentPath);
                        renderFolderList(parentPath);
                    } else {
                        // Root level dataset
                        currentPath = '';
                        renderBreadcrumb('');
                        renderFolderList('');
                    }
                }

                // Populate port dropdown excluding this instance's port
                populatePortOptions(name);
                document.getElementById('instancePort').value = instance.port;
                updateSelectedPortDisplay();

                // Fetch .env rule for this path (to cache it and mark .env option), then set stored mode
                suppressDuplicateDefault = false;
                if (instance.datasetPath) {
                    fetchDuplicateRule(instance.datasetPath, false);
                }
                document.getElementById('duplicateMode').value = instance.duplicateMode || 'move';
                document.getElementById('threshold').disabled = (instance.duplicateMode || 'move') === 'none';
                // Show the instance's stored duplicate mode in the info block
                updateDuplicateModeDisplay();
            } catch (err) {
                alert(`Failed to load instance: ${err.message}`);
            }
        }

        function closeModal() {
            document.getElementById('instanceModal').classList.remove('active');
            editingInstance = null;
        }

        async function checkAndUpdatePentagonFormat(instanceName) {
            try {
                const response = await fetch(`${API_BASE}/api/instances/${instanceName}/check-format`);
                if (!response.ok) return;

                const data = await response.json();
                if (data.format === 'obb' || data.format === 'pentagon') {
                    // Auto-check the format checkbox if dataset is already in OBB format
                    document.getElementById('pentagonFormat').checked = true;
                }
            } catch (err) {
                console.error('Error checking dataset format:', err);
            }
        }

        async function handlePentagonFormatChange(instanceName, shouldConvert) {
            if (!shouldConvert) return; // User unchecked, no action needed

            try {
                const response = await fetch(`${API_BASE}/api/instances/${instanceName}/convert-pentagon`, {
                    method: 'POST'
                });

                const data = await response.json();

                if (!response.ok) {
                    alert(`${t('common.error')}: ${data.error}`);
                    document.getElementById('pentagonFormat').checked = false;
                    return;
                }

                if (!data.alreadyConverted) {
                    alert(t('manager.modal.convertedCount', { count: data.convertedCount }));
                }
            } catch (err) {
                console.error('Error converting to OBB format:', err);
                alert(`${t('common.error')}: ${err.message}`);
                document.getElementById('pentagonFormat').checked = false;
            }
        }

        async function saveInstance(event) {
            event.preventDefault();

            const name = document.getElementById('instanceName').value;
            const port = parseInt(document.getElementById('instancePort').value, 10);
            const datasetPath = document.getElementById('datasetPath').value;
            const threshold = parseFloat(document.getElementById('threshold').value) || config.defaultIouThreshold;
            const autoSync = document.getElementById('autoSync').checked;
            const pentagonFormat = document.getElementById('pentagonFormat').checked;
            const obbMode = document.getElementById('obbMode').value || 'rectangle';
            const classFile = document.getElementById('classFile').value || null;
            const duplicateMode = document.getElementById('duplicateMode').value || 'move';

            if (!validateInstanceName()) {
                return;
            }

            const data = { name, port, datasetPath, threshold, autoSync, pentagonFormat, obbMode, classFile, duplicateMode };

            try {
                if (!config.portRange) {
                    document.getElementById('modalError').textContent = t('manager.errors.configNotLoaded');
                    document.getElementById('modalError').style.display = 'block';
                    return;
                }
                if (Number.isNaN(port) || port < config.portRange.start || port > config.portRange.end) {
                    const message = t('manager.errors.portOutOfRange', {
                        start: config.portRange.start,
                        end: config.portRange.end
                    });
                    document.getElementById('modalError').textContent = message;
                    document.getElementById('modalError').style.display = 'block';
                    return;
                }

                const url = editingInstance
                    ? `${API_BASE}/api/instances/${editingInstance}`
                    : `${API_BASE}/api/instances`;
                const method = editingInstance ? 'PUT' : 'POST';

                const response = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                if (!response.ok) {
                    const error = await response.json();
                    document.getElementById('modalError').textContent = error.error;
                    document.getElementById('modalError').style.display = 'block';
                    return;
                }

                // Handle OBB format conversion if checked
                if (pentagonFormat) {
                    await handlePentagonFormatChange(name, true);
                }

                closeModal();
                refreshInstances();
            } catch (err) {
                document.getElementById('modalError').textContent = err.message;
                document.getElementById('modalError').style.display = 'block';
            }
        }

        async function showLogs(name) {
            document.getElementById('logsTitle').textContent = t('manager.logsTitle', { name });
            document.getElementById('logsContent').textContent = t('manager.loadingLogs');
            document.getElementById('logsModal').classList.add('active');
            activeLogsInstance = name;
            followLogs = true;
            toggleScrollLatest(false);
            attachLogsScrollHandler();

            await fetchAndRenderLogs(name);
            startLogsAutoRefresh(name);
        }

        function closeLogsModal() {
            document.getElementById('logsModal').classList.remove('active');
            stopLogsAutoRefresh();
        }

        // Close modal on background click
        document.addEventListener('click', (e) => {
            const modal = document.getElementById('logsModal');
            if (!modal) return;
            if (modal.classList.contains('active') && e.target === modal) {
                closeLogsModal();
            }
        });

        // Close modal on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modal = document.getElementById('logsModal');
                if (modal && modal.classList.contains('active')) {
                    closeLogsModal();
                }
            }
        });

        function refreshInstances() {
            loadInstances();
        }

        function startLogsAutoRefresh(name) {
            stopLogsAutoRefresh();
            logsIntervalId = setInterval(() => fetchAndRenderLogs(name), LOG_POLL_MS);
        }

        function stopLogsAutoRefresh() {
            if (logsIntervalId) {
                clearInterval(logsIntervalId);
                logsIntervalId = null;
            }
            activeLogsInstance = null;
        }

        function toggleScrollLatest(show) {
            const btn = document.getElementById('scrollLatestBtn');
            if (!btn) return;
            btn.style.display = show ? 'block' : 'none';
        }

        function scrollToLatest() {
            const container = document.getElementById('logsContent');
            if (!container) return;
            followLogs = true;
            toggleScrollLatest(false);
            container.scrollTop = container.scrollHeight;
        }

        function attachLogsScrollHandler() {
            const container = document.getElementById('logsContent');
            if (!container || container.dataset.listenerAttached) return;
            container.addEventListener('scroll', () => {
                const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
                const nearBottom = distanceFromBottom <= SCROLL_THRESHOLD;
                followLogs = nearBottom;
                toggleScrollLatest(!nearBottom);
            });
            container.dataset.listenerAttached = 'true';
        }

        function hideInstanceNameError() {
            const errorEl = document.getElementById('instanceNameError');
            const input = document.getElementById('instanceName');
            const saveBtn = document.getElementById('saveInstanceBtn');
            if (errorEl) errorEl.style.display = 'none';
            if (input) input.classList.remove('input-error');
            if (saveBtn) saveBtn.disabled = false;
        }

        function validateInstanceName() {
            const input = document.getElementById('instanceName');
            const errorEl = document.getElementById('instanceNameError');
            const saveBtn = document.getElementById('saveInstanceBtn');
            if (!input || !errorEl) return true;

            const name = input.value.trim();
            const validFormat = /^[A-Za-z0-9_-]+$/.test(name);
            const isSameAsEditing = editingInstance && name === editingInstance;
            const exists = latestInstances.some(i => i.name === name);
            const duplicate = name && exists && !isSameAsEditing;
            const invalidFormat = name && !validFormat;
            const invalid = duplicate || invalidFormat;

            if (invalidFormat) {
                errorEl.textContent = t('manager.modal.instanceNameInvalid');
                errorEl.style.display = 'block';
                input.classList.add('input-error');
            } else if (duplicate) {
                errorEl.textContent = t('manager.modal.instanceNameExists');
                errorEl.style.display = 'block';
                input.classList.add('input-error');
            } else {
                hideInstanceNameError();
            }

            if (saveBtn) {
                saveBtn.disabled = invalid;
            }

            return !invalid;
        }

        async function fetchAndRenderLogs(name) {
            const container = document.getElementById('logsContent');
            if (!container || !name) return;

            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

            try {
                const response = await fetch(`${API_BASE}/api/instances/${name}/logs?lines=all`);
                const logs = await response.json();

                // Debug info
                let debugText = '';
                if (logs._debug) {
                    debugText = `[DEBUG] Out log exists: ${logs._debug.outLogExists}, size: ${logs._debug.outLogSize || 0}, lines: ${logs._debug.outLogLineCount || 0}\n`;
                    debugText += `[DEBUG] Out path: ${logs._debug.outLogPath}\n`;
                    if (logs._debug.errLogSkipped) {
                        debugText += `[DEBUG] Err log skipped (only reading -out.log)\n`;
                    }
                    debugText += '\n';
                }

                // Combine stdout and stderr, with clear separation
                let combined = debugText;
                if (logs.stdout && logs.stdout.trim()) {
                    combined += '=== STDOUT ===\n' + logs.stdout + '\n';
                }
                if (logs.stderr && logs.stderr.trim()) {
                    combined += '=== STDERR ===\n' + logs.stderr;
                }

                container.textContent = combined || t('manager.noLogsAvailable');

                if (followLogs) {
                    container.scrollTop = container.scrollHeight;
                } else {
                    const newDistance = Math.max(0, container.scrollHeight - container.clientHeight - distanceFromBottom);
                    container.scrollTop = newDistance;
                }
            } catch (err) {
                container.textContent = `${t('manager.errors.failedToLoadLogs')}: ${err.message}`;
            }
        }

        let initialized = false;
        let refreshTimer = null;

        function bindFormHandlers() {
            const nameInput = document.getElementById('instanceName');
            if (nameInput) {
                nameInput.addEventListener('blur', validateInstanceName);
                nameInput.addEventListener('input', () => {
                    hideInstanceNameError();
                });
            }

            const classInput = document.getElementById('classFile');
            if (classInput) {
                classInput.addEventListener('change', () => previewClassFile(classInput.value));
                classInput.addEventListener('blur', () => previewClassFile(classInput.value));
            }

            const pentagonCheckbox = document.getElementById('pentagonFormat');
            if (pentagonCheckbox) {
                pentagonCheckbox.addEventListener('change', () => {
                    const obbModeGroup = document.getElementById('obbModeGroup');
                    if (obbModeGroup) {
                        obbModeGroup.style.display = pentagonCheckbox.checked ? 'block' : 'none';
                    }
                });
            }

            // Update duplicate mode and instance name when dataset path is manually changed
            const datasetPathInput = document.getElementById('datasetPath');
            if (datasetPathInput) {
                function onDatasetPathChange() {
                    const val = datasetPathInput.value.trim();
                    fetchDuplicateRule(val, true);
                    const instanceNameField = document.getElementById('instanceName');
                    if (instanceNameField && !instanceNameField.disabled) {
                        const parts = val.replace(/\/+$/, '').split('/').filter(p => p);
                        if (parts.length > 0) {
                            instanceNameField.value = parts[parts.length - 1];
                            validateInstanceName();
                        }
                    }
                }
                datasetPathInput.addEventListener('change', onDatasetPathChange);
                datasetPathInput.addEventListener('blur', onDatasetPathChange);
            }
        }

        function exposeToWindow() {
            if (typeof window === 'undefined') return;
            window.startSelectedInstances = startSelectedInstances;
            window.stopSelectedInstances = stopSelectedInstances;
            window.removeSelectedInstances = removeSelectedInstances;
            window.openLabelEditorMain = openLabelEditorMain;
            window.showAddModal = showAddModal;
            window.closeModal = closeModal;
            window.toggleSelectAll = toggleSelectAll;
            window.updateSelectedPortDisplay = updateSelectedPortDisplay;
            window.navigateToPath = navigateToPath;
            window.navigateToClassPath = navigateToClassPath;
            window.saveInstance = saveInstance;
            window.closeLogsModal = closeLogsModal;
            window.scrollToLatest = scrollToLatest;
            window.refreshAndStay = refreshAndStay;
            window.toggleInstanceSelection = toggleInstanceSelection;
            window.startInstance = startInstance;
            window.stopInstance = stopInstance;
            window.restartInstance = restartInstance;
            window.openInstance = openInstance;
            window.openLabelEditor = openLabelEditor;
            window.editInstance = editInstance;
            window.deleteInstance = deleteInstance;
            window.showLogs = showLogs;
            window.selectClassFile = selectClassFile;
            window.filterFolderList = filterFolderList;
            window.clearFolderSearch = clearFolderSearch;
            window.filterClassFolderList = filterClassFolderList;
            window.clearClassFolderSearch = clearClassFolderSearch;
            window.updateDuplicateModeDisplay = updateDuplicateModeDisplay;
            window.currentClassPath = currentClassPath;
        }

        function refreshLocalizedUI() {
            updateObbModeOptions();
            renderBreadcrumb(currentPath);
            renderFolderList(currentPath);
            renderClassBreadcrumb(currentClassPath);
            renderClassFolderList(currentClassPath);
            renderInstances(latestInstances);
            updateSelectionButtons();

            const modalTitle = document.getElementById('modalTitle');
            if (modalTitle) {
                modalTitle.textContent = editingInstance ? t('manager.modal.editTitle') : t('manager.modal.addTitle');
            }

            const logsTitle = document.getElementById('logsTitle');
            if (logsTitle && activeLogsInstance) {
                logsTitle.textContent = t('manager.logsTitle', { name: activeLogsInstance });
            }

            const portSelect = document.getElementById('instancePort');
            if (portSelect && portSelect._allPorts) {
                const updatedPorts = portSelect._allPorts.map(port => ({
                    ...port,
                    label: port.available
                        ? `${port.value} (${t('common.available')})`
                        : `${port.value} (${t('common.inUse')})`
                }));
                portSelect._allPorts = updatedPorts;
                renderPortOptions(updatedPorts);
            }
        }

        export function initManager() {
            if (initialized || typeof window === 'undefined') {
                return;
            }
            initialized = true;
            initI18n().then(() => {
                refreshLocalizedUI();
            });
            onLanguageChange(refreshLocalizedUI);
            exposeToWindow();
            bindFormHandlers();
            loadConfig().then(() => {
                const refreshInterval = config.healthCheckInterval || 5000;
                refreshTimer = setInterval(loadInstances, refreshInterval);
            });
            loadInstances();
        }

        export {
            startSelectedInstances,
            stopSelectedInstances,
            removeSelectedInstances,
            openLabelEditorMain,
            showAddModal,
            closeModal,
            toggleSelectAll,
            updateSelectedPortDisplay,
            navigateToPath,
            navigateToClassPath,
            saveInstance,
            closeLogsModal,
            scrollToLatest,
            toggleInstanceSelection,
            startInstance,
            stopInstance,
            restartInstance,
            openInstance,
            openLabelEditor,
            editInstance,
            deleteInstance,
            showLogs,
            selectClassFile,
            filterFolderList,
            clearFolderSearch,
            filterClassFolderList,
            clearClassFolderSearch,
            updateDuplicateModeDisplay
        };
