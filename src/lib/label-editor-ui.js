import { initI18n, onLanguageChange, t } from '@/lib/i18n';

// Configuration
        const DEFAULT_CLASSES = ['one', 'two', 'three', 'four', 'five', 'six', 'invalid'];
        const BASE_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#E74C3C'];
        let CLASSES = [...DEFAULT_CLASSES];
        const LABEL_CLIPBOARD_KEY = 'label_editor_clipboard';
        const LINE_WIDTH_SCALE_DEFAULT = 2 / 3;
        const LABEL_EDITOR_PRELOAD_COUNT_DEFAULT = 20;
        const THUMBNAIL_MAX_SIZE = 512;

        // State
        let lastStatusKey = null;
        let lastStatusParams = null;
        let lastFilterWarningKey = null;
        let lastFilterWarningParams = null;
        let image = null;
        let labelData = null;
        let annotations = [];
        // defaultAnnotationType is set by admin (via existing labels) - 'bbox' or 'obb'
        let defaultAnnotationType = 'bbox';
        // obbCreationMode: set by admin via URL parameter - 'rectangle' or '4point'
        // Both modes create OBB format annotations, just different creation methods
        // Default is 'rectangle', will be set from obbModeParam during init
        let obbCreationMode = 'rectangle';
        let isRotating = false;
        let rotateState = null;
        let isGroupRotating = false;
        let groupRotateState = null;
        let selectedClass = 0;
        let selectedAnnotation = null;
        let selectedAnnotations = []; // Multi-selection support (array of indices)
        let isDrawing = false;
        let drawStart = null;
        let currentBox = null;
        let isDragging = false;
        let dragHandle = null;
        let resizeStart = null;
        let isPanning = false;
        let panStart = null;
        let baseScale = 1; // Scale to fit image to canvas
        let viewScale = 1; // User zoom level
        let viewOffsetX = 0;
        let viewOffsetY = 0;
        let pendingSelection = null;
        let lastHitIndices = [];
        let lastHitCycle = 0;
        let lastHitPoint = null;

        // Navigation key-hold protection: skip image loading when key held > 300ms
        let navKeyHeldSince = null; // timestamp when nav key first pressed
        let navKeyHeld = false; // true once held past threshold
        const NAV_KEY_HOLD_THRESHOLD = 300; // ms

        // Multi-image support
        let allImageList = []; // Full unfiltered list
        let imageList = []; // Filtered list (used for navigation)
        let currentImageIndex = 0;
        let basePath = '';
        let imageThumbnails = {}; // Store thumbnails for preview
        let preloadedImages = new Map(); // Cache preloaded Image objects by image path
        let preloadedLabels = new Map(); // Cache preloaded label data by image path
        let imageLoadRetryCount = new Map(); // Track per-image load retries
        let imageLoadSeq = 0; // Monotonic counter to ignore stale load callbacks
        let activeImageLoadSeq = 0;
        let currentLabelPath = ''; // Current label path for saving
        let imageMetaByPath = {};
        let previewDragInitialized = false;
        let previewScrollInitialized = false;
        let previewRenderStart = 0;
        let previewRenderEnd = 0;
        let previewSortMode = 'name-asc';
        let hasUnsavedChanges = false;
        let pendingPreviewCenter = null;
        let previewSearchQuery = ''; // Search query for preview filtering
        let previewSearchDebounceTimer = null;
        let filterBaseList = []; // List after main filter (before preview search)
        let isCreatingObb = false;
        let obbCreatePoints = [];
        let obbPreviewPoint = null;
        let isCreatingTwoPoint = false; // For 2-point rectangle creation
        let twoPointFirst = null; // First corner point
        let twoPointPreview = null; // Preview second corner
        let isSelectingBox = false; // For drag selection box
        let selectionBoxStart = null; // Selection box start point
        let selectionBoxCurrent = null; // Selection box current point
        let mouseCanvasPoint = null;
        let showCrosshair = false;
        let lastMouseClient = null;
        let isMoving = false;
        let moveStart = null;
        let moveMoved = false;
        let previewDragState = {
            isDown: false,
            moved: false,
            startX: 0,
            scrollLeft: 0,
            pointerId: null,
            dragging: false,
            rafId: null,
            lastDeltaX: 0
        };
        const HISTORY_LIMIT = 100;
        let undoStack = [];
        let redoStack = [];
        let historySnapshot = null;

        // Image select mode
        let selectedImages = new Set();
        let imageSelectMode = false;
        let currentInstanceName = '';
        let currentJobId = '';

        // Filter support
        let labelCache = {}; // Cache label info for filtering: { imagePath: { classes: [0,1,2], count: 3 } }
        let filterActive = false;
        let labelsPreloaded = false;
        let filterDebounceTimer = null;
        let lineWidthScale = LINE_WIDTH_SCALE_DEFAULT;
        let isApplyingSavedFilter = false;
        let labelEditorPreloadCount = LABEL_EDITOR_PRELOAD_COUNT_DEFAULT;
        let thumbnailBatchLoading = new Set();
        let thumbnailBatchPromises = new Map();
        let totalThumbnailBytes = 0;
        let autoSaveTimeout = null;
        let autoSaveInProgress = false;
        const AUTO_SAVE_DELAY = 400;
        let pasteCount = 0;

        // Canvas
        let canvas = null;
        let ctx = null;

        // Get URL parameters
        const urlParams = new URLSearchParams(window.location.search);

        // Support both old (full paths) and new (base + relative) format
        const imagePath = urlParams.get('image');
        const labelPath = urlParams.get('label');
        basePath = urlParams.get('base') || '';
        const relativeImage = urlParams.get('img');
        const relativeLabel = urlParams.get('lbl');
        let folderParam = urlParams.get('folder');
        const instanceNameParam = urlParams.get('instance') || '';
        const jobIdParam = urlParams.get('jobId') || '';
        let startImageParam = urlParams.get('start');
        let lastKnownImageParam = startImageParam || '';

        // Get OBB creation mode from URL parameter (set by admin in manager)
        // Default is 'rectangle' if not specified
        let obbModeParam = urlParams.get('obbMode') || 'rectangle';

        // Support multiple images (comma-separated)
        const imageListParam = urlParams.get('images');
        if (imageListParam) {
            allImageList = imageListParam.split(',').map(img => img.trim());
        } else if (relativeImage) {
            allImageList = [relativeImage];
        } else if (imagePath) {
            allImageList = [imagePath];
        }
        imageList = [...allImageList]; // Initialize filtered list
        filterBaseList = [...allImageList]; // Initialize filter base list

        // Load images from folder if folder parameter is provided
        async function loadImagesFromFolder() {
            if (!folderParam || !basePath) {
                return false;
            }

            try {
                showStatusMessage('editor.status.loadingImages');
                const response = await fetch(`/api/label-editor/list-folder?basePath=${encodeURIComponent(basePath)}&folder=${encodeURIComponent(folderParam)}`);

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || t('editor.errors.failedToLoadFolderGeneric'));
                }

                const data = await response.json();
                allImageList = data.images;
                imageMetaByPath = data.imageMeta || {};
                imageList = [...allImageList]; // Initialize filtered list
                filterBaseList = [...allImageList]; // Initialize filter base list
                preloadedImages.clear(); // Clear preload cache
                preloadedLabels.clear();
                if (startImageParam && imageList.includes(startImageParam)) {
                    currentImageIndex = imageList.indexOf(startImageParam);
                }

                if (imageList.length === 0) {
                    showError(t('editor.errors.noImagesFound'));
                    return false;
                }

                applyPreviewSort(false);
                showStatusMessage('editor.status.loadedImages', { count: imageList.length });
                return true;
            } catch (err) {
                showError(t('editor.errors.failedToLoadFolder', { error: err.message }));
                return false;
            }
        }

        function applyLabelEditorPreloadCount(value) {
            const parsed = parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed >= 0) {
                labelEditorPreloadCount = parsed;
            }
        }

        // Initialize
        async function initLabelEditor() {
            canvas = document.getElementById('canvas');
            if (!canvas) {
                console.error('Canvas element not found!');
                return;
            }
            ctx = canvas.getContext('2d');

            await initI18n();
            onLanguageChange(() => {
                updateObbModeDisplay();
                updateInstructions();
                updateFilterStats();
                handlePreviewSearch();
                updateImagePreview(true);
                refreshStatusBar();
                refreshFilterWarning();
                updateSaveButtonState();
            });

            // Fetch config from instance if instance parameter is provided
            let preloadCountLoaded = false;

            if (jobIdParam && !basePath) {
                try {
                    const cfgResp = await fetch(`/api/label-editor/instance-config?jobId=${encodeURIComponent(jobIdParam)}`);
                    if (cfgResp.ok) {
                        const cfg = await cfgResp.json();
                        basePath = cfg.basePath || '';
                        folderParam = folderParam || cfg.folder || '';
                        obbModeParam = obbModeParam !== 'rectangle' ? obbModeParam : (cfg.obbMode || 'rectangle');
                        if (!startImageParam && cfg.lastImagePath) {
                            startImageParam = cfg.lastImagePath;
                            lastKnownImageParam = startImageParam;
                        }
                        if (cfg.labelEditorPreloadCount !== undefined) {
                            applyLabelEditorPreloadCount(cfg.labelEditorPreloadCount);
                            preloadCountLoaded = true;
                        }
                    } else {
                        const err = await cfgResp.json().catch(() => ({}));
                        showErrorMessage(err.error || 'Failed to load job config');
                        return;
                    }
                } catch (err) {
                    console.warn('Failed to load job config:', err);
                }
            } else if (instanceNameParam && !basePath) {
                try {
                    const cfgResp = await fetch(`/api/label-editor/instance-config?name=${encodeURIComponent(instanceNameParam)}`);
                    if (cfgResp.ok) {
                        const cfg = await cfgResp.json();
                        basePath = cfg.basePath || '';
                        folderParam = folderParam || cfg.folder || '';
                        obbModeParam = obbModeParam !== 'rectangle' ? obbModeParam : (cfg.obbMode || 'rectangle');
                        if (!startImageParam && cfg.lastImagePath) {
                            startImageParam = cfg.lastImagePath;
                            lastKnownImageParam = startImageParam;
                        }
                        if (cfg.labelEditorPreloadCount !== undefined) {
                            applyLabelEditorPreloadCount(cfg.labelEditorPreloadCount);
                            preloadCountLoaded = true;
                        }
                    }
                } catch (err) {
                    console.warn('Failed to load instance config:', err);
                }
            }

            if (!preloadCountLoaded) {
                try {
                    const cfgResp = await fetch('/api/config');
                    if (cfgResp.ok) {
                        const cfg = await cfgResp.json();
                        if (cfg.labelEditorPreloadCount !== undefined) {
                            applyLabelEditorPreloadCount(cfg.labelEditorPreloadCount);
                        }
                    }
                } catch (err) {
                    // Ignore config errors and keep default
                }
            }

            // Store identity for persistence
            currentInstanceName = instanceNameParam;
            currentJobId = jobIdParam;

            // Set OBB creation mode from URL parameter (admin-controlled)
            obbCreationMode = obbModeParam;

            // Load from folder if folder parameter is provided
            if (folderParam) {
                const loaded = await loadImagesFromFolder();
                if (!loaded) return;
            }

            if (imageList.length === 0) {
                showError(t('editor.status.missingImagePath'));
                return;
            }

            if (startImageParam) {
                if (imageList.includes(startImageParam)) {
                    currentImageIndex = imageList.indexOf(startImageParam);
                } else {
                    const idx = imageList.findIndex(p => p.split('/').pop() === startImageParam);
                    if (idx >= 0) currentImageIndex = idx;
                }
            }
            await applyLastImageSelection();
            applyPreviewSort(true);
            await loadClassNames();
            loadLineWidthScale();
            updateSaveButtonState();
            setupClassSelector();
            setupFilterUI();
            await loadSavedFilter();
            setupEventListeners();
            updateInstructions(); // Initialize instructions based on default format
            updateNavigationButtons();
            setupImagePreview();
            await loadImage();
            await loadSelectedImages();

            // Preload all labels in the background for instant navigation
            preloadAllLabels();
            // Preload all images in batches
            preloadAllImagesInBatches();
        }

        // === FILTER FUNCTIONS ===

        // Debounced version for text input
        function applyFiltersDebounced() {
            if (filterDebounceTimer) {
                clearTimeout(filterDebounceTimer);
            }
            filterDebounceTimer = setTimeout(() => {
                applyFilters();
            }, 300); // Wait 300ms after user stops typing
        }

        function setupFilterUI() {
            // Setup class filter checkboxes
            const filterClassesDiv = document.getElementById('filterClasses');
            filterClassesDiv.innerHTML = ''; // Clear any existing content

            CLASSES.forEach((cls, idx) => {
                const item = document.createElement('div');
                item.className = 'filter-checkbox-item';
                item.dataset.className = cls.toLowerCase();

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = `filter-class-${idx}`;
                checkbox.value = idx;
                checkbox.onchange = () => {
                    console.log(`Checkbox ${cls} (${idx}) changed to ${checkbox.checked}`);
                    updateSelectedClassChips();
                    applyFilters();
                };

                const label = document.createElement('label');
                label.htmlFor = `filter-class-${idx}`;
                label.textContent = cls;
                label.style.cursor = 'pointer';
                label.style.color = getClassColor(idx);

                item.appendChild(checkbox);
                item.appendChild(label);
                filterClassesDiv.appendChild(item);
            });

            setupClassSearchInput();
            updateSelectedClassChips();
            console.log('Filter UI setup complete. Created checkboxes for:', CLASSES);
        }

        function setupClassSearchInput() {
            const classSearchInput = document.getElementById('filterClassSearch');
            if (!classSearchInput) {
                return;
            }

            classSearchInput.oninput = () => {
                const query = classSearchInput.value.trim().toLowerCase();
                filterClassListBySearch(query);
            };
        }

        function filterClassListBySearch(query) {
            const filterClassesDiv = document.getElementById('filterClasses');
            if (!filterClassesDiv) {
                return;
            }

            const items = filterClassesDiv.querySelectorAll('.filter-checkbox-item');
            items.forEach(item => {
                const matches = !query || item.dataset.className.includes(query);
                item.style.display = matches ? 'flex' : 'none';
            });
        }

        function updateSelectedClassChips() {
            const classChips = document.getElementById('filterClassChips');
            if (!classChips) {
                return;
            }

            classChips.innerHTML = '';
            CLASSES.forEach((cls, idx) => {
                const checkbox = document.getElementById(`filter-class-${idx}`);
                if (checkbox && checkbox.checked) {
                    const chip = document.createElement('div');
                    chip.className = 'filter-class-chip';
                    chip.style.borderColor = getClassColor(idx);
                    chip.innerHTML = `${cls} <span>×</span>`;
                    chip.onclick = () => {
                        checkbox.checked = false;
                        updateSelectedClassChips();
                        applyFilters();
                    };
                    classChips.appendChild(chip);
                }
            });
        }

        function buildFilterState() {
            const nameFilter = document.getElementById('filterName').value.trim();
            const classMode = document.getElementById('filterClassMode').value;
            const classLogic = document.getElementById('filterClassLogic').value;
            const minLabels = parseInt(document.getElementById('filterMinLabels').value) || 0;
            const maxLabelsInput = document.getElementById('filterMaxLabels').value.trim();
            const maxLabels = maxLabelsInput === '' ? null : parseInt(maxLabelsInput);
            const selectedClasses = [];
            CLASSES.forEach((_, idx) => {
                const checkbox = document.getElementById(`filter-class-${idx}`);
                if (checkbox && checkbox.checked) {
                    selectedClasses.push(idx);
                }
            });
            return {
                nameFilter,
                classMode,
                classLogic,
                minLabels,
                maxLabels,
                selectedClasses
            };
        }

        async function saveFilterState(filterState, sortMode = previewSortMode) {
            if (!currentJobId && !currentInstanceName) return;
            if (isApplyingSavedFilter) return;
            try {
                await fetch('/api/label-editor/filter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(currentJobId
                        ? { jobId: Number(currentJobId), filter: filterState, previewSortMode: sortMode }
                        : { name: currentInstanceName, filter: filterState, previewSortMode: sortMode })
                });
            } catch (err) {
                console.warn('Failed to save filter state:', err);
            }
        }

        async function savePreviewSortMode(sortMode) {
            if (!currentJobId && !currentInstanceName) return;
            if (isApplyingSavedFilter) return;
            try {
                await fetch('/api/label-editor/filter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(currentJobId
                        ? { jobId: Number(currentJobId), previewSortMode: sortMode }
                        : { name: currentInstanceName, previewSortMode: sortMode })
                });
            } catch (err) {
                console.warn('Failed to save preview sort mode:', err);
            }
        }

        function applyFilterState(filterState) {
            if (!filterState) return;
            document.getElementById('filterName').value = filterState.nameFilter || '';
            document.getElementById('filterClassMode').value = filterState.classMode || 'any';
            document.getElementById('filterClassLogic').value = filterState.classLogic || 'or';
            document.getElementById('filterMinLabels').value = filterState.minLabels || 0;
            document.getElementById('filterMaxLabels').value = filterState.maxLabels ?? '';

            const selected = new Set(Array.isArray(filterState.selectedClasses) ? filterState.selectedClasses : []);
            CLASSES.forEach((_, idx) => {
                const checkbox = document.getElementById(`filter-class-${idx}`);
                if (checkbox) {
                    checkbox.checked = selected.has(idx);
                }
            });
            updateSelectedClassChips();
        }

        async function loadSavedFilter() {
            if (!currentJobId && !currentInstanceName) return;
            try {
                const url = currentJobId
                    ? `/api/label-editor/filter?jobId=${encodeURIComponent(currentJobId)}`
                    : `/api/label-editor/filter?name=${encodeURIComponent(currentInstanceName)}`;
                const resp = await fetch(url);
                if (!resp.ok) return;
                const data = await resp.json();
                if (!data) return;
                isApplyingSavedFilter = true;
                if (data.previewSortMode) {
                    previewSortMode = data.previewSortMode;
                    applyPreviewSort(true);
                }
                if (data.filter) {
                    applyFilterState(data.filter);
                    await applyFilters();
                } else if (data.previewSortMode) {
                    updateNavigationButtons();
                    updateImagePreview(true);
                }
            } catch (err) {
                console.warn('Failed to load saved filter:', err);
            } finally {
                isApplyingSavedFilter = false;
            }
        }

        function getClassColor(index) {
            if (BASE_COLORS[index]) {
                return BASE_COLORS[index];
            }
            const hue = (index * 47) % 360;
            return `hsl(${hue}, 70%, 55%)`;
        }

        async function loadClassNames() {
            showStatusMessage('editor.status.loadingClasses');
            // Prefer instance name for exact lookup; fall back to path-based matching
            if (instanceNameParam) {
                try {
                    const response = await fetch(`/api/label-editor/classes?instanceName=${encodeURIComponent(instanceNameParam)}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (Array.isArray(data.classes) && data.classes.length > 0) {
                            CLASSES = data.classes;
                            showStatusMessage('editor.status.ready');
                            return;
                        }
                    }
                } catch (error) {
                    console.warn('Failed to load classes by instance name:', error);
                }
            }

            const classBasePath = resolveClassBasePath();
            if (!classBasePath) {
                CLASSES = [...DEFAULT_CLASSES];
                showStatusMessage('editor.status.ready');
                return;
            }

            try {
                const response = await fetch(`/api/label-editor/classes?basePath=${encodeURIComponent(classBasePath)}`);
                if (!response.ok) {
                    throw new Error('Failed to load class names');
                }
                const data = await response.json();
                if (Array.isArray(data.classes) && data.classes.length > 0) {
                    CLASSES = data.classes;
                } else {
                    CLASSES = [...DEFAULT_CLASSES];
                }
            } catch (error) {
                console.warn('Failed to load class names:', error);
                CLASSES = [...DEFAULT_CLASSES];
            }
            showStatusMessage('editor.status.ready');
        }

        function resolveClassBasePath() {
            if (basePath) {
                return basePath;
            }
            if (imagePath && imagePath.includes('/images/')) {
                return imagePath.split('/images/')[0];
            }
            if (allImageList.length > 0 && allImageList[0].includes('/images/')) {
                return allImageList[0].split('/images/')[0];
            }
            return '';
        }

        function toggleFilterSection() {
            const content = document.getElementById('filterContent');
            const icon = document.getElementById('filterToggleIcon');

            if (content.classList.contains('collapsed')) {
                content.classList.remove('collapsed');
                icon.textContent = '▼';
            } else {
                content.classList.add('collapsed');
                icon.textContent = '▶';
            }
        }

        function updateObbModeDisplay() {
            const obbModeDisplay = document.getElementById('obbModeDisplay');
            if (!obbModeDisplay) return;

            if (obbCreationMode === 'rectangle') {
                obbModeDisplay.textContent = `🔲 ${t('editor.obbMode.rectangle')}`;
            } else {
                obbModeDisplay.textContent = `⬡ ${t('editor.obbMode.fourPoint')}`;
            }
        }

        function updateInstructions() {
            const instructionsList = document.querySelector('.instructions ul');
            if (!instructionsList) return;

            let instructions = `<li>${t('editor.instructions.selectClass')}</li>`;

            if (defaultAnnotationType === 'bbox') {
                instructions += `<li>${t('editor.instructions.createBbox')}</li>`;
            } else if (defaultAnnotationType === 'obb') {
                if (obbCreationMode === 'rectangle') {
                    instructions += `<li>${t('editor.instructions.createObbDrag')}</li>`;
                } else {
                    instructions += `<li>${t('editor.instructions.createObbFourPoint')}</li>`;
                }
                if (obbCreationMode === '4point') {
                    instructions += `<li>${t('editor.instructions.cancelCreation')}</li>`;
                }
            }

            instructions += `
                <li>${t('editor.instructions.clickToSelect')}</li>
                <li>${t('editor.instructions.shiftDragSelect')}</li>
                <li>${t('editor.instructions.ctrlClickSelect')}</li>
                <li>${t('editor.instructions.selectAll')}</li>
                <li>${t('editor.instructions.dragGroupMove')}</li>
                <li>${t('editor.instructions.dragGroupResize')}</li>
                <li>${t('editor.instructions.deleteSelected')}</li>
                <li>${t('editor.instructions.escapeClear')}</li>
                <li>${t('editor.instructions.dragResizeSingle')}</li>
                <li>${t('editor.instructions.navKeys')}</li>
                <li>${t('editor.instructions.undoRedo')}</li>
                <li>${t('editor.instructions.copyPaste')}</li>
                <li>${t('editor.instructions.middleClickPan')}</li>
                <li>${t('editor.instructions.xToggleSelect')}</li>
                <li>${t('editor.instructions.checkboxSelect')}</li>
                <li>${t('editor.instructions.deleteImages')}</li>
            `;

            instructionsList.innerHTML = instructions;
        }

        // Load metadata from backend for all images (or batch)
        async function loadMetadataFromBackend(imagePaths) {
            try {
                const response = await fetch('/api/label-editor/get-metadata', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        basePath: basePath,
                        images: imagePaths
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to load metadata');
                }

                const data = await response.json();

                // Merge into cache
                Object.assign(labelCache, data.metadata);

                return data.metadata;
            } catch (err) {
                console.error('Error loading metadata:', err);
                return {};
            }
        }

        async function getLabelInfo(imagePath) {
            // Check cache first
            if (labelCache[imagePath]) {
                return labelCache[imagePath];
            }

            // Load from backend
            const metadata = await loadMetadataFromBackend([imagePath]);
            return metadata[imagePath] || { classes: [], count: 0 };
        }

        async function applyFilters() {
            try {
                showStatusMessage('editor.filter.applyingFilters');

                clearFilterWarning();

                // Clear preview search when applying main filter
                const previewSearchInput = document.getElementById('previewSearch');
                if (previewSearchInput) {
                    previewSearchInput.value = '';
                    previewSearchQuery = '';
                }

                // Get filter values
                const nameFilter = document.getElementById('filterName').value.trim();
                const classMode = document.getElementById('filterClassMode').value;
                const classLogic = document.getElementById('filterClassLogic').value;
                const minLabels = parseInt(document.getElementById('filterMinLabels').value) || 0;
                const maxLabelsInput = document.getElementById('filterMaxLabels').value.trim();
                const maxLabels = maxLabelsInput ? parseInt(maxLabelsInput) : null;

                if (maxLabels !== null && minLabels > maxLabels) {
                    showFilterWarningMessage('editor.filter.minCannotBeGreaterThanMax');
                    return;
                }

                // Get selected classes
                const selectedClasses = [];
                CLASSES.forEach((cls, idx) => {
                    const checkbox = document.getElementById(`filter-class-${idx}`);
                    if (checkbox && checkbox.checked) {
                        selectedClasses.push(idx);
                    }
                });

                console.log('Filter criteria:', {
                    nameFilter,
                    classMode,
                    classLogic,
                    minLabels,
                    maxLabels,
                    selectedClasses
                });

                if (classMode === 'only' && selectedClasses.length === 0) {
                    showFilterWarningMessage('editor.filter.selectClassesForOnly');
                    return;
                }

                // Check if any filter is active
                const hasActiveFilter = nameFilter || selectedClasses.length > 0 || minLabels > 0 || maxLabels !== null || classMode !== 'any';
                await saveFilterState(hasActiveFilter ? {
                    nameFilter,
                    classMode,
                    classLogic,
                    minLabels,
                    maxLabels,
                    selectedClasses
                } : null);

                if (!hasActiveFilter) {
                    // No filters active, show all
                    imageList = sortImageList(allImageList);
                    filterBaseList = [...imageList]; // Reset filter base
                    preloadedImages.clear(); // Clear preload cache
                    filterActive = false;
                    updateFilterStats();
                    currentImageIndex = 0;
                    await loadImage();
                    updateNavigationButtons();
                    updateImagePreview(true);
                    showStatusMessage('editor.filter.noFiltersActive');
                    return;
                }

                let filteredImages;
                const filterParams = {
                    nameFilter,
                    selectedClasses,
                    classMode,
                    classLogic,
                    minLabels,
                    maxLabels: maxLabels !== null ? maxLabels : undefined
                };

                if (labelsPreloaded) {
                    // Client-side filtering (instant, no network)
                    filteredImages = filterImagesLocally(allImageList, filterParams);
                    console.log(`Filtered ${allImageList.length} images down to ${filteredImages.length} (client-side)`);
                } else {
                    // Fallback: server-side filtering (before preload completes)
                    const response = await fetch('/api/label-editor/filter-images', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            basePath: basePath,
                            images: allImageList,
                            filters: filterParams
                        })
                    });

                    if (!response.ok) {
                        throw new Error(t('editor.filter.failedToFilter'));
                    }

                    const data = await response.json();
                    filteredImages = data.filteredImages;
                    console.log(`Filtered ${data.totalCount} images down to ${data.filteredCount} (server-side)`);
                }

                // Update image list
                const previousImage = imageList[currentImageIndex];
                imageList = filteredImages;
                imageList = sortImageList(imageList);
                filterBaseList = [...imageList]; // Update filter base for preview search
                preloadedImages.clear(); // Clear preload cache
                filterActive = true;

                // Update stats
                updateFilterStats();

                // Reset to first image if current index is out of bounds
                if (previousImage && imageList.includes(previousImage)) {
                    currentImageIndex = imageList.indexOf(previousImage);
                } else if (currentImageIndex >= imageList.length) {
                    currentImageIndex = 0;
                }

                // Reload UI
                if (imageList.length > 0) {
                    await loadImage();
                    updateNavigationButtons();
                    updateImagePreview(true);
                    showStatusMessage('editor.filter.foundMatching', { count: imageList.length });
                } else {
                    showError(t('editor.filter.noImagesMatchFilter'));
                }

            } catch (error) {
                console.error('Error applying filters:', error);
                showError(t('editor.filter.filterError', { error: error.message }));
            }
        }

        function updateFilterStats() {
            const stats = document.getElementById('filterStats');
            const previewCount = document.getElementById('imagePreviewCount');

            if (filterActive) {
                stats.textContent = t('editor.filter.showingFiltered', {
                    shown: imageList.length,
                    total: allImageList.length
                });
                stats.style.color = '#007bff';
                previewCount.innerHTML = t('editor.preview.countFiltered', {
                    shown: `<span style="color: #007bff;">${imageList.length}</span>`,
                    total: allImageList.length
                });
            } else {
                stats.textContent = t('editor.filter.showingAllCount', { total: allImageList.length });
                stats.style.color = '#aaa';
                previewCount.textContent = t('editor.preview.countAll', { total: allImageList.length });
            }

            updatePreviewProgress();
        }

        function updatePreviewProgress() {
            const fill = document.getElementById('previewProgressFill');
            if (!fill || imageList.length === 0) {
                if (fill) {
                    fill.style.width = '0%';
                }
                return;
            }

            const current = Math.min(imageList.length, Math.max(1, currentImageIndex + 1));
            const percent = (current / imageList.length) * 100;
            fill.style.width = `${percent.toFixed(2)}%`;
        }

        function showFilterWarning(message) {
            const warning = document.getElementById('filterWarning');
            if (!warning) {
                return;
            }

            warning.textContent = message;
            warning.style.display = 'block';
        }

        function showFilterWarningMessage(key, params) {
            lastFilterWarningKey = key;
            lastFilterWarningParams = params;
            showFilterWarning(t(key, params));
        }

        function clearFilterWarning() {
            const warning = document.getElementById('filterWarning');
            if (!warning) {
                return;
            }

            warning.style.display = 'none';
            lastFilterWarningKey = null;
            lastFilterWarningParams = null;
        }

        function refreshFilterWarning() {
            const warning = document.getElementById('filterWarning');
            if (!warning || warning.style.display === 'none') {
                return;
            }
            if (lastFilterWarningKey) {
                warning.textContent = t(lastFilterWarningKey, lastFilterWarningParams);
            }
        }

        function clearFilters() {
            const currentImagePath = imageList[currentImageIndex];
            // Clear all filter inputs
            document.getElementById('filterName').value = '';
            document.getElementById('filterClassMode').value = 'any';
            document.getElementById('filterClassLogic').value = 'any';
            const classSearchInput = document.getElementById('filterClassSearch');
            if (classSearchInput) {
                classSearchInput.value = '';
                filterClassListBySearch('');
            }
            document.getElementById('filterMinLabels').value = '0';
            document.getElementById('filterMaxLabels').value = '';

            // Clear preview search
            const previewSearchInput = document.getElementById('previewSearch');
            if (previewSearchInput) {
                previewSearchInput.value = '';
                previewSearchQuery = '';
            }

            // Uncheck all class filters
            CLASSES.forEach((cls, idx) => {
                const checkbox = document.getElementById(`filter-class-${idx}`);
                if (checkbox) {
                    checkbox.checked = false;
                }
            });

            updateSelectedClassChips();

            // Reset to all images
            imageList = sortImageList(allImageList);
            filterBaseList = [...imageList]; // Reset filter base
            preloadedImages.clear(); // Clear preload cache
            filterActive = false;
            if (currentImagePath && imageList.includes(currentImagePath)) {
                currentImageIndex = imageList.indexOf(currentImagePath);
            } else {
                currentImageIndex = 0;
            }

            // Update UI
            updateFilterStats();
            clearFilterWarning();
            saveFilterState(null);
            loadImage();
            updateNavigationButtons();
            updateImagePreview(true);
            showStatusMessage('editor.filter.filtersCleared');
        }

        function resetFilterAndSort() {
            previewSortMode = 'name-asc';
            const sortSelect = document.getElementById('previewSort');
            if (sortSelect) {
                sortSelect.value = previewSortMode;
            }
            savePreviewSortMode(previewSortMode);
            clearFilters();
            showStatusMessage('editor.filter.resetAll');
        }

        // === END FILTER FUNCTIONS ===


        function setupImagePreview() {
            if (allImageList.length > 1) {
                document.getElementById('previewBar').classList.add('show');
                updateFilterStats();
            }
            const sortSelect = document.getElementById('previewSort');
            if (sortSelect) {
                sortSelect.value = previewSortMode;
            }
        }

        function sortImageList(list) {
            const sorted = [...list];
            const nameCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            const createdCompare = (a, b) => {
                const aMeta = imageMetaByPath[a];
                const bMeta = imageMetaByPath[b];
                const aTime = aMeta ? aMeta.ctimeMs : null;
                const bTime = bMeta ? bMeta.ctimeMs : null;
                if (aTime !== null && bTime !== null && aTime !== bTime) {
                    return aTime - bTime;
                }
                return nameCompare(a, b);
            };

            if (previewSortMode === 'created-desc') {
                sorted.sort((a, b) => createdCompare(b, a));
                return sorted;
            }

            if (previewSortMode === 'created-asc') {
                sorted.sort((a, b) => createdCompare(a, b));
                return sorted;
            }

            if (previewSortMode === 'name-desc') {
                sorted.sort((a, b) => nameCompare(b, a));
                return sorted;
            }

            sorted.sort((a, b) => nameCompare(a, b));
            return sorted;
        }

        function applyPreviewSort(keepSelection = true) {
            const currentImage = imageList[currentImageIndex];
            allImageList = sortImageList(allImageList);
            imageList = sortImageList(imageList);
            if (keepSelection && currentImage && imageList.includes(currentImage)) {
                currentImageIndex = imageList.indexOf(currentImage);
            } else if (currentImageIndex >= imageList.length) {
                currentImageIndex = 0;
            }
        }

        async function applyLastImageSelection() {
            if (!currentJobId && (!folderParam || !basePath)) {
                return;
            }
            try {
                const response = await fetch(currentJobId
                    ? `/api/label-editor/last-image?jobId=${encodeURIComponent(currentJobId)}`
                    : `/api/label-editor/last-image?basePath=${encodeURIComponent(basePath)}&folder=${encodeURIComponent(folderParam)}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.lastImagePath) {
                        lastKnownImageParam = data.lastImagePath;
                    }
                }
            } catch (err) {
                // Ignore fetch errors and fall back to start param.
            }
            if (lastKnownImageParam) {
                const normalizedStart = normalizeStartImagePathForList(lastKnownImageParam);
                if (normalizedStart && imageList.includes(normalizedStart)) {
                    currentImageIndex = imageList.indexOf(normalizedStart);
                } else {
                    // Match by filename only (lastImagePath may be just a filename)
                    const idx = imageList.findIndex(p => p.split('/').pop() === lastKnownImageParam);
                    if (idx >= 0) {
                        currentImageIndex = idx;
                    }
                }
            }
        }

        function normalizeStartImagePathForList(imagePath) {
            if (!imagePath) {
                return '';
            }
            if (!folderParam) {
                return imagePath;
            }
            const normalizedFolder = folderParam.replace(/\/+$/, '');
            if (imagePath.startsWith(`${normalizedFolder}/`)) {
                return imagePath;
            }
            if (imagePath.startsWith('images/') && normalizedFolder.endsWith('/images') && normalizedFolder !== 'images') {
                const datasetPrefix = normalizedFolder.replace(/\/images$/, '');
                return `${datasetPrefix}/${imagePath}`;
            }
            return imagePath;
        }

        function handlePreviewSortChange() {
            const select = document.getElementById('previewSort');
            previewSortMode = select.value;
            savePreviewSortMode(previewSortMode);
            applyPreviewSort(true);
            updateNavigationButtons();
            updateImagePreview(true);
        }

        function handlePreviewSearch() {
            const searchInput = document.getElementById('previewSearch');
            const newQuery = searchInput.value.trim();

            // Debounce the search
            if (previewSearchDebounceTimer) {
                clearTimeout(previewSearchDebounceTimer);
            }

            previewSearchDebounceTimer = setTimeout(() => {
                performPreviewSearch(newQuery);
            }, 300);
        }

        async function performPreviewSearch(query) {
            previewSearchQuery = query;
            const countDisplay = document.getElementById('imagePreviewCount');

            // If empty query, restore to filter base list
            if (!query) {
                imageList = [...filterBaseList];
                // Find current image in the restored list
                const currentPath = imageList.length > 0 ? imageList[currentImageIndex] : null;
                if (currentPath) {
                    const newIndex = imageList.indexOf(currentPath);
                    if (newIndex >= 0) {
                        currentImageIndex = newIndex;
                    } else {
                        currentImageIndex = 0;
                    }
                } else {
                    currentImageIndex = 0;
                }

                updateFilterStats();
                updateNavigationButtons();
                updateImagePreview(true);
                return;
            }

            // Client-side string matching (no network request needed)
            const searchResults = filterBaseList.filter(p => p.toLowerCase().includes(query.toLowerCase()));

            // Store current image path before updating list
            const currentPath = imageList[currentImageIndex];

            // Update image list with search results
            imageList = searchResults;

            // Try to keep current image if it's in search results
            if (currentPath) {
                const newIndex = imageList.indexOf(currentPath);
                if (newIndex >= 0) {
                    currentImageIndex = newIndex;
                } else if (imageList.length > 0) {
                    // Current image not in results, go to first result
                    currentImageIndex = 0;
                    await loadImage();
                }
            } else if (imageList.length > 0) {
                currentImageIndex = 0;
            }

            // Update count display
            if (filterActive) {
                countDisplay.innerHTML = t('editor.preview.countSearchFilteredAll', {
                    shown: `<span style="color: #007bff;">${imageList.length}</span>`,
                    total: `<span style="color: #007bff;">${filterBaseList.length}</span>`,
                    all: allImageList.length
                });
            } else {
                countDisplay.innerHTML = t('editor.preview.countFiltered', {
                    shown: `<span style="color: #007bff;">${imageList.length}</span>`,
                    total: filterBaseList.length
                });
            }

            updateNavigationButtons();
            updateImagePreview(true);

            if (imageList.length === 0) {
                showStatusMessage('editor.filter.noImagesMatchFilter');
            }
        }

        async function updateImagePreview(forceRebuild) {
            // Show preview bar if there are multiple images in total (even if filtered to 1)
            if (allImageList.length <= 1) return;

            const previewContainer = document.getElementById('imagePreview');

            // If no images in filtered list, show message
            if (imageList.length === 0) {
                previewContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: #aaa;">${t('editor.preview.noMatchingImages')}</div>`;
                return;
            }

            // Lightweight update: if current index is within the rendered window, just swap classes
            if (!forceRebuild && currentImageIndex >= previewRenderStart && currentImageIndex < previewRenderEnd) {
                const items = previewContainer.querySelectorAll('.preview-item');
                items.forEach(item => {
                    const idx = parseInt(item.dataset.previewIndex, 10);
                    const imgPath = imageList[idx];
                    item.classList.toggle('active', idx === currentImageIndex);
                    // Update selection state
                    item.classList.toggle('selected-image', selectedImages.has(imgPath));
                    const cb = item.querySelector('.preview-checkbox');
                    if (cb) cb.textContent = selectedImages.has(imgPath) ? '✓' : '';
                });
                applyPendingPreviewCenter();
                return;
            }

            previewContainer.innerHTML = '';

            // Create a wrapper for thumbnails to ensure horizontal layout
            const thumbnailsWrapper = document.createElement('div');
            thumbnailsWrapper.style.cssText = 'display: flex; gap: 8px;';

            // Only load 25 thumbnails at a time (12 before, current, 12 after)
            const THUMBNAIL_WINDOW = 25;
            const halfWindow = Math.floor(THUMBNAIL_WINDOW / 2);

            // Calculate range to display
            let startIdx = Math.max(0, currentImageIndex - halfWindow);
            let endIdx = Math.min(imageList.length, currentImageIndex + halfWindow + 1);

            // Adjust if we're near the start or end
            if (endIdx - startIdx < THUMBNAIL_WINDOW) {
                if (startIdx === 0) {
                    endIdx = Math.min(imageList.length, THUMBNAIL_WINDOW);
                } else if (endIdx === imageList.length) {
                    startIdx = Math.max(0, imageList.length - THUMBNAIL_WINDOW);
                }
            }

            previewRenderStart = startIdx;
            previewRenderEnd = endIdx;

            for (let i = startIdx; i < endIdx; i++) {
                thumbnailsWrapper.appendChild(createPreviewItem(i));
            }

            // Append thumbnails wrapper to container
            previewContainer.appendChild(thumbnailsWrapper);
            setupPreviewDrag();
            setupPreviewInfiniteScroll();
            applyPendingPreviewCenter();
            preloadPreviewThumbnails(previewRenderStart, previewRenderEnd);

            // Reapply search filter if there is one
            if (previewSearchQuery) {
                handlePreviewSearch();
            }
        }

        function drawPreviewAnnotations(canvas, img, imagePath) {
            const pCtx = canvas.getContext('2d');
            const cw = canvas.width;
            const ch = canvas.height;
            pCtx.clearRect(0, 0, cw, ch);
            if (!img.naturalWidth || !img.naturalHeight) return;
            if (img.dataset.loaded !== 'true') return;
            const cached = preloadedLabels.get(imagePath);
            if (!cached || cached.loading || !cached.labelContent) return;
            const anns = parseLabelData(cached.labelContent);
            if (!anns || anns.length === 0) return;

            const imgW = img.naturalWidth;
            const imgH = img.naturalHeight;
            const scale = Math.max(cw / imgW, ch / imgH);
            const ox = (imgW * scale - cw) / 2;
            const oy = (imgH * scale - ch) / 2;

            pCtx.lineWidth = 1.5;
            anns.forEach(ann => {
                pCtx.strokeStyle = getClassColor(ann.class);
                if (ann.type === 'obb') {
                    pCtx.beginPath();
                    ann.points.forEach((p, i) => {
                        const px = p.x * imgW * scale - ox;
                        const py = p.y * imgH * scale - oy;
                        if (i === 0) pCtx.moveTo(px, py);
                        else pCtx.lineTo(px, py);
                    });
                    pCtx.closePath();
                    pCtx.stroke();
                } else {
                    const bx = (ann.x - ann.w / 2) * imgW * scale - ox;
                    const by = (ann.y - ann.h / 2) * imgH * scale - oy;
                    const bw = ann.w * imgW * scale;
                    const bh = ann.h * imgH * scale;
                    pCtx.strokeRect(bx, by, bw, bh);
                }
            });
        }

        function updatePreviewAnnotations() {
            const previewContainer = document.getElementById('imagePreview');
            if (!previewContainer) return;
            previewContainer.querySelectorAll('.preview-item').forEach(item => {
                const img = item.querySelector('img');
                const annCanvas = item.querySelector('canvas.preview-annotations');
                if (!img || !annCanvas) return;
                const imagePath = img.dataset.imagePath;
                if (imagePath) {
                    drawPreviewAnnotations(annCanvas, img, imagePath);
                }
            });
        }

        function createPreviewItem(index) {
            const imagePath = imageList[index]; // Get the actual image path from filtered list

            const previewItem = document.createElement('div');
            previewItem.className = 'preview-item';
            previewItem.dataset.previewIndex = index;
            if (index === currentImageIndex) {
                previewItem.classList.add('active');
            }

            // Create image element
            const img = document.createElement('img');
            img.draggable = false;
            img.dataset.imagePath = imagePath;

            // Canvas overlay for annotation previews
            const annCanvas = document.createElement('canvas');
            annCanvas.className = 'preview-annotations';
            annCanvas.width = 100;
            annCanvas.height = 100;

            img.onload = () => {
                drawPreviewAnnotations(annCanvas, img, imagePath);
            };

            // Use image path as cache key instead of index
            if (imageThumbnails[imagePath]) {
                img.src = imageThumbnails[imagePath];
                img.dataset.loaded = 'true';
            } else {
                const loadingText = encodeURIComponent(t('common.loading'));
                img.src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="%23333"/><text x="50%" y="50%" text-anchor="middle" fill="%23aaa" font-size="12">${loadingText}</text></svg>`;
            }

            const label = document.createElement('div');
            label.className = 'preview-label';
            const filename = imagePath.split('/').pop();

            // Show filename intelligently - if too long, show end part (usually has unique number)
            if (filename.length > 15) {
                label.textContent = '...' + filename.slice(-12);
                label.title = filename; // Show full name on hover
            } else {
                label.textContent = filename;
            }

            // Checkbox overlay for selection
            const checkbox = document.createElement('div');
            checkbox.className = 'preview-checkbox';
            checkbox.textContent = selectedImages.has(imagePath) ? '✓' : '';
            checkbox.onclick = (e) => {
                e.stopPropagation();
                toggleImageSelection(imagePath);
            };
            previewItem.appendChild(checkbox);

            if (selectedImages.has(imagePath)) {
                previewItem.classList.add('selected-image');
            }

            previewItem.appendChild(img);
            previewItem.appendChild(annCanvas);
            previewItem.appendChild(label);

            previewItem.onclick = async () => {
                if (previewDragState.moved) {
                    previewDragState.moved = false;
                    return;
                }
                if (currentImageIndex !== index) {
                    await saveLabels(false);
                    currentImageIndex = index;
                    await loadImage();
                    updateNavigationButtons();
                    requestPreviewCenter(index, true);
                    updateImagePreview();
                }
            };

            // Auto-scroll to active item
            if (index === currentImageIndex) {
                setTimeout(() => {
                    if (!pendingPreviewCenter) {
                        requestPreviewCenter(index, false);
                    }
                    applyPendingPreviewCenter();
                }, 0);
            }

            return previewItem;
        }

        function requestPreviewCenter(index, animate) {
            pendingPreviewCenter = { index, animate };
        }

        function applyPendingPreviewCenter() {
            if (!pendingPreviewCenter) {
                centerPreviewIndex(currentImageIndex, false);
                return;
            }

            const { index, animate } = pendingPreviewCenter;
            pendingPreviewCenter = null;
            centerPreviewIndex(index, animate);
        }

        function centerPreviewIndex(index, animate) {
            const previewContainer = document.getElementById('imagePreview');
            if (!previewContainer) {
                return;
            }

            const target = previewContainer.querySelector(`[data-preview-index="${index}"]`);
            if (!target) {
                return;
            }

            centerPreviewItem(target, animate);
        }

        function setupPreviewInfiniteScroll() {
            if (previewScrollInitialized) {
                return;
            }

            const previewContainer = document.getElementById('imagePreview');
            if (!previewContainer) {
                return;
            }

            let scrollRaf = null;
            const threshold = 80;
            const batchSize = 12;

            const onScroll = () => {
                if (scrollRaf !== null) {
                    return;
                }

                scrollRaf = requestAnimationFrame(() => {
                    scrollRaf = null;
                    const maxScroll = previewContainer.scrollWidth - previewContainer.clientWidth;
                    const wrapper = previewContainer.firstElementChild;
                    if (!wrapper) {
                        return;
                    }

                    if (previewContainer.scrollLeft < threshold && previewRenderStart > 0) {
                        const previousStart = previewRenderStart;
                        const newStart = Math.max(0, previewRenderStart - batchSize);
                        const prevScrollWidth = previewContainer.scrollWidth;
                        const fragment = document.createDocumentFragment();
                        for (let i = newStart; i < previousStart; i++) {
                            fragment.appendChild(createPreviewItem(i));
                        }
                        wrapper.insertBefore(fragment, wrapper.firstChild);
                        const newScrollWidth = previewContainer.scrollWidth;
                        previewContainer.scrollLeft += newScrollWidth - prevScrollWidth;
                        previewRenderStart = newStart;
                        preloadPreviewThumbnails(newStart, previousStart);

                        // Apply search filter to new items
                        if (previewSearchQuery) {
                            handlePreviewSearch();
                        }
                    }

                    if (maxScroll - previewContainer.scrollLeft < threshold && previewRenderEnd < imageList.length) {
                        const newEnd = Math.min(imageList.length, previewRenderEnd + batchSize);
                        for (let i = previewRenderEnd; i < newEnd; i++) {
                            wrapper.appendChild(createPreviewItem(i));
                        }
                        preloadPreviewThumbnails(previewRenderEnd, newEnd);
                        previewRenderEnd = newEnd;

                        // Apply search filter to new items
                        if (previewSearchQuery) {
                            handlePreviewSearch();
                        }
                    }
                });
            };

            previewContainer.addEventListener('scroll', onScroll);
            previewScrollInitialized = true;
        }

        function centerPreviewItem(previewItem, animate) {
            const previewContainer = document.getElementById('imagePreview');
            if (!previewContainer || !previewItem) {
                return;
            }

            const containerRect = previewContainer.getBoundingClientRect();
            const itemRect = previewItem.getBoundingClientRect();
            const currentScroll = previewContainer.scrollLeft;
            const targetScroll = currentScroll + (itemRect.left - containerRect.left) - (containerRect.width / 2) + (itemRect.width / 2);
            const maxScroll = previewContainer.scrollWidth - previewContainer.clientWidth;
            const clampedTarget = Math.max(0, Math.min(maxScroll, targetScroll));

            if (!animate) {
                previewContainer.scrollLeft = clampedTarget;
                return;
            }

            smoothScrollTo(previewContainer, clampedTarget, 250);
        }

        function smoothScrollTo(container, target, durationMs) {
            const start = container.scrollLeft;
            const distance = target - start;
            const startTime = performance.now();

            const step = (now) => {
                const elapsed = now - startTime;
                const t = Math.min(1, elapsed / durationMs);
                const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                container.scrollLeft = start + distance * eased;
                if (t < 1) {
                    requestAnimationFrame(step);
                }
            };

            requestAnimationFrame(step);
        }

        function setupPreviewDrag() {
            if (previewDragInitialized) {
                return;
            }

            const previewContainer = document.getElementById('imagePreview');
            if (!previewContainer) {
                return;
            }

            previewContainer.addEventListener('wheel', (event) => {
                event.preventDefault();
                const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
                previewContainer.scrollLeft += delta;
            }, { passive: false });

            previewContainer.addEventListener('contextmenu', (event) => {
                event.preventDefault();
            });

            previewContainer.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) {
                    return;
                }

                previewDragState.isDown = true;
                previewDragState.moved = false;
                previewDragState.dragging = false;
                previewDragState.startX = event.clientX;
                previewDragState.scrollLeft = previewContainer.scrollLeft;
                previewDragState.pointerId = event.pointerId;
                previewDragState.lastDeltaX = 0;
                previewContainer.classList.add('dragging');
            });

            previewContainer.addEventListener('pointermove', (event) => {
                if (!previewDragState.isDown) {
                    return;
                }

                const deltaX = event.clientX - previewDragState.startX;
                if (Math.abs(deltaX) > 5) {
                    previewDragState.moved = true;
                    if (!previewDragState.dragging) {
                        previewDragState.dragging = true;
                        previewContainer.setPointerCapture(previewDragState.pointerId);
                    }
                }
                previewDragState.lastDeltaX = deltaX;
                if (previewDragState.rafId === null) {
                    previewDragState.rafId = requestAnimationFrame(() => {
                        previewContainer.scrollLeft = previewDragState.scrollLeft - previewDragState.lastDeltaX;
                        previewDragState.rafId = null;
                    });
                }
            });

            const stopDrag = (event) => {
                if (!previewDragState.isDown) {
                    return;
                }

                previewDragState.isDown = false;
                previewDragState.dragging = false;
                if (previewDragState.rafId !== null) {
                    cancelAnimationFrame(previewDragState.rafId);
                    previewDragState.rafId = null;
                }
                previewContainer.classList.remove('dragging');
                if (previewDragState.pointerId !== null) {
                    previewContainer.releasePointerCapture(previewDragState.pointerId);
                    previewDragState.pointerId = null;
                }
            };

            previewContainer.addEventListener('pointerup', stopDrag);
            previewContainer.addEventListener('pointercancel', stopDrag);
            previewContainer.addEventListener('pointerleave', () => {
                if (previewDragState.isDown) {
                    previewDragState.isDown = false;
                    previewContainer.classList.remove('dragging');
                }
            });

            previewContainer.addEventListener('click', (event) => {
                if (previewDragState.moved) {
                    event.preventDefault();
                    event.stopPropagation();
                    previewDragState.moved = false;
                }
            }, true);

            previewDragInitialized = true;
        }

        // Build image URL - use short format when instance name is available
        function buildImageUrl(imagePath, cacheBuster = '') {
            if (currentInstanceName) {
                const filename = imagePath.split('/').pop();
                return `/api/image?i=${encodeURIComponent(currentInstanceName)}&n=${encodeURIComponent(filename)}${cacheBuster}`;
            }
            // Fallback to old format
            if (basePath) {
                return `/api/image?basePath=${encodeURIComponent(basePath)}&relativePath=${encodeURIComponent(imagePath)}${cacheBuster}`;
            }
            return `/api/image?fullPath=${encodeURIComponent(imagePath)}${cacheBuster}`;
        }

        function getPreviewImageSelector(imagePath) {
            const escaped = (window.CSS && CSS.escape)
                ? CSS.escape(imagePath)
                : imagePath.replace(/["\\]/g, '\\$&');
            return `img[data-image-path="${escaped}"]`;
        }

        function setPreviewImageSrc(imagePath, dataUrl) {
            const previewContainer = document.getElementById('imagePreview');
            if (!previewContainer) {
                return;
            }
            const selector = getPreviewImageSelector(imagePath);
            previewContainer.querySelectorAll(selector).forEach((img) => {
                img.dataset.loaded = 'true';
                img.src = dataUrl;
            });
        }

        const THUMBNAIL_FALLBACK_BATCH_SIZE = 200;

        function findBytes(haystack, needle, start) {
            for (let i = start; i <= haystack.length - needle.length; i++) {
                let found = true;
                for (let j = 0; j < needle.length; j++) {
                    if (haystack[i + j] !== needle[j]) {
                        found = false;
                        break;
                    }
                }
                if (found) return i;
            }
            return -1;
        }

        function parseMultipartThumbnails(buffer, boundary) {
            const bytes = new Uint8Array(buffer);
            const decoder = new TextDecoder();
            const separator = new TextEncoder().encode('\r\n\r\n');
            const boundaryBytes = new TextEncoder().encode('--' + boundary);
            const thumbnails = {};
            let pos = 0;

            while (pos < bytes.length) {
                const bStart = findBytes(bytes, boundaryBytes, pos);
                if (bStart === -1) break;
                pos = bStart + boundaryBytes.length;
                if (pos + 1 < bytes.length && bytes[pos] === 0x2D && bytes[pos + 1] === 0x2D) break;
                if (pos + 1 < bytes.length && bytes[pos] === 0x0D && bytes[pos + 1] === 0x0A) pos += 2;

                const headerEnd = findBytes(bytes, separator, pos);
                if (headerEnd === -1) break;
                const headersStr = decoder.decode(bytes.slice(pos, headerEnd));
                pos = headerEnd + 4;

                let name = '';
                let contentLength = -1;
                let contentType = 'image/jpeg';
                headersStr.split('\r\n').forEach(function(line) {
                    const nameMatch = line.match(/Content-Disposition:.*name="([^"]+)"/i);
                    if (nameMatch) name = decodeURIComponent(nameMatch[1]);
                    const clMatch = line.match(/Content-Length:\s*(\d+)/i);
                    if (clMatch) contentLength = parseInt(clMatch[1], 10);
                    const ctMatch = line.match(/Content-Type:\s*(.+)/i);
                    if (ctMatch) contentType = ctMatch[1].trim();
                });

                if (name && contentLength > 0) {
                    const imageData = bytes.slice(pos, pos + contentLength);
                    const blob = new Blob([imageData], { type: contentType });
                    thumbnails[name] = URL.createObjectURL(blob);
                    totalThumbnailBytes += contentLength;
                    pos += contentLength;
                }

                if (pos + 1 < bytes.length && bytes[pos] === 0x0D && bytes[pos + 1] === 0x0A) pos += 2;
            }
            const count = Object.keys(thumbnails).length;
            if (count > 0) {
                const mb = (totalThumbnailBytes / (1024 * 1024)).toFixed(2);
                console.log(`Thumbnails: +${count} loaded, total ${mb} MB in memory`);
            }
            return thumbnails;
        }

        async function fetchThumbnailBatchSingle(imagePaths) {
            const payload = { imagePaths, maxSize: THUMBNAIL_MAX_SIZE };
            if (basePath) {
                payload.basePath = basePath;
            }
            if (currentInstanceName) {
                payload.instanceName = currentInstanceName;
            }
            const response = await fetch('/api/label-editor/load-thumbnails-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`Thumbnail batch failed: ${response.status}`);
            }
            const contentType = response.headers.get('Content-Type') || '';
            const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
            if (!boundaryMatch) {
                throw new Error('Missing boundary in response');
            }
            const buffer = await response.arrayBuffer();
            return parseMultipartThumbnails(buffer, boundaryMatch[1]);
        }

        async function fetchThumbnailBatch(imagePaths) {
            if (!imagePaths.length) {
                return {};
            }
            try {
                return await fetchThumbnailBatchSingle(imagePaths);
            } catch (err) {
                if (imagePaths.length <= THUMBNAIL_FALLBACK_BATCH_SIZE) {
                    return {};
                }
                console.warn(`Thumbnail batch of ${imagePaths.length} failed, retrying in chunks of ${THUMBNAIL_FALLBACK_BATCH_SIZE}...`);
                const allThumbnails = {};
                for (let i = 0; i < imagePaths.length; i += THUMBNAIL_FALLBACK_BATCH_SIZE) {
                    const chunk = imagePaths.slice(i, i + THUMBNAIL_FALLBACK_BATCH_SIZE);
                    try {
                        const thumbnails = await fetchThumbnailBatchSingle(chunk);
                        Object.assign(allThumbnails, thumbnails);
                    } catch (chunkErr) {
                        console.warn(`Thumbnail chunk at ${i} failed, skipping`);
                    }
                }
                return allThumbnails;
            }
        }

        async function preloadPreviewThumbnails(startIdx, endIdx) {
            const batchPaths = [];
            for (let i = startIdx; i < endIdx; i++) {
                const imagePath = imageList[i];
                if (!imagePath) {
                    continue;
                }
                if (!imageThumbnails[imagePath]) {
                    if (thumbnailBatchLoading.has(imagePath)) {
                        continue;
                    }
                    thumbnailBatchLoading.add(imagePath);
                    batchPaths.push(imagePath);
                }
            }

            if (batchPaths.length === 0) {
                return;
            }

            try {
                const batchPromise = fetchThumbnailBatch(batchPaths);
                batchPaths.forEach((imagePath) => {
                    thumbnailBatchPromises.set(imagePath, batchPromise);
                });
                const thumbnails = await batchPromise;
                Object.entries(thumbnails).forEach(([imagePath, dataUrl]) => {
                    if (dataUrl) {
                        imageThumbnails[imagePath] = dataUrl;
                        setPreviewImageSrc(imagePath, dataUrl);
                    }
                });
            } catch (err) {
                // Ignore errors and allow retry on next batch
            } finally {
                batchPaths.forEach((imagePath) => {
                    thumbnailBatchLoading.delete(imagePath);
                    thumbnailBatchPromises.delete(imagePath);
                });
            }
        }

        async function preloadImageObjects(imagePaths) {
            const toFetch = [];
            imagePaths.forEach((imagePath) => {
                if (!imagePath) {
                    return;
                }
                if (imageThumbnails[imagePath]) {
                    if (!preloadedImages.has(imagePath)) {
                        const img = new Image();
                        img.onerror = () => {
                            preloadedImages.delete(imagePath);
                        };
                        img.src = imageThumbnails[imagePath];
                        preloadedImages.set(imagePath, img);
                    }
                    return;
                }
                if (thumbnailBatchLoading.has(imagePath)) {
                    return;
                }
                if (!thumbnailBatchLoading.has(imagePath)) {
                    thumbnailBatchLoading.add(imagePath);
                    toFetch.push(imagePath);
                }
            });

            if (toFetch.length === 0) {
                return;
            }

            try {
                const batchPromise = fetchThumbnailBatch(toFetch);
                toFetch.forEach((imagePath) => {
                    thumbnailBatchPromises.set(imagePath, batchPromise);
                });
                const thumbnails = await batchPromise;
                Object.entries(thumbnails).forEach(([imagePath, dataUrl]) => {
                    if (dataUrl) {
                        imageThumbnails[imagePath] = dataUrl;
                        setPreviewImageSrc(imagePath, dataUrl);
                        if (!preloadedImages.has(imagePath)) {
                            const img = new Image();
                            img.onerror = () => {
                                preloadedImages.delete(imagePath);
                            };
                            img.src = dataUrl;
                            preloadedImages.set(imagePath, img);
                        }
                    }
                });
            } finally {
                toFetch.forEach((imagePath) => {
                    thumbnailBatchLoading.delete(imagePath);
                    thumbnailBatchPromises.delete(imagePath);
                });
            }
        }

        async function waitForThumbnail(imagePath, timeoutMs = 2000) {
            if (imageThumbnails[imagePath]) {
                return true;
            }
            const pending = thumbnailBatchPromises.get(imagePath);
            if (!pending) {
                return false;
            }
            try {
                await Promise.race([
                    pending,
                    new Promise((resolve) => setTimeout(resolve, timeoutMs))
                ]);
            } catch (err) {
                // ignore
            }
            return Boolean(imageThumbnails[imagePath]);
        }

        function updateNavigationButtons() {
            const prevBtn = document.getElementById('prevBtn');
            const nextBtn = document.getElementById('nextBtn');
            const counter = document.getElementById('imageCounter');

            if (imageList.length > 1) {
                counter.style.display = '';
                prevBtn.style.display = '';
                nextBtn.style.display = '';
                const indexInput = document.getElementById('imageIndexInput');
                const totalSpan = document.getElementById('imageCounterTotal');
                if (indexInput && totalSpan) {
                    indexInput.value = currentImageIndex + 1;
                    indexInput.dataset.max = imageList.length;
                    totalSpan.textContent = `/ ${imageList.length}`;
                } else {
                    counter.textContent = `${currentImageIndex + 1} / ${imageList.length}`;
                }
                prevBtn.disabled = currentImageIndex === 0;
                nextBtn.disabled = currentImageIndex === imageList.length - 1;
            } else {
                counter.style.display = 'none';
                prevBtn.style.display = 'none';
                nextBtn.style.display = 'none';
            }

            updatePreviewProgress();
        }

        async function previousImage() {
            if (currentImageIndex > 0) {
                clearAllCreation();
                await saveLabels(false); // Save current before switching
                currentImageIndex--;
                await loadImage();
                updateNavigationButtons();
                updateImagePreview();
            }
        }

        async function nextImage() {
            if (currentImageIndex < imageList.length - 1) {
                clearAllCreation();
                await saveLabels(false); // Save current before switching
                currentImageIndex++;
                await loadImage();
                updateNavigationButtons();
                updateImagePreview();
            }
        }

        async function goToImageIndex(index) {
            const clamped = Math.max(0, Math.min(imageList.length - 1, index));
            if (clamped === currentImageIndex) {
                updateNavigationButtons(); // reset input if value was invalid
                return;
            }
            clearAllCreation();
            await saveLabels(false);
            currentImageIndex = clamped;
            await loadImage();
            updateNavigationButtons();
            updateImagePreview();
        }

        function setupClassSelector() {
            const selector = document.getElementById('classSelector');
            selector.innerHTML = '';
            CLASSES.forEach((cls, idx) => {
                const btn = document.createElement('button');
                btn.className = 'class-btn';
                btn.textContent = cls;
                btn.style.borderColor = getClassColor(idx);
                btn.onclick = () => selectClass(idx);
                if (idx === 0) btn.classList.add('active');
                selector.appendChild(btn);
            });
        }

        function updateClassSelector() {
            // Highlight the class of the selected annotation
            document.querySelectorAll('.class-btn').forEach((btn, idx) => {
                if (selectedAnnotation !== null && annotations[selectedAnnotation]) {
                    btn.classList.toggle('active', idx === annotations[selectedAnnotation].class);
                } else {
                    btn.classList.toggle('active', idx === selectedClass);
                }
            });
        }

        function selectClass(classIdx) {
            // If multiple annotations are selected, change all their classes
            if (selectedAnnotations.length > 0) {
                changeMultipleAnnotationsClass(selectedAnnotations, classIdx);
            } else if (selectedAnnotation !== null) {
                // Single annotation selected
                changeAnnotationClass(selectedAnnotation, classIdx);
            }

            // Update selected class for new annotations
            selectedClass = classIdx;
            document.querySelectorAll('.class-btn').forEach((btn, idx) => {
                btn.classList.toggle('active', idx === classIdx);
            });
        }

        async function loadImage(forceReload) {
            try {
                showStatusMessage('editor.status.loadingImage');

                // Reset UI state
                document.getElementById('errorMessage').style.display = 'none';
                document.getElementById('loading').style.display = 'block';
                document.getElementById('canvas').style.display = 'none';

                // Get current image path
                const currentImage = imageList[currentImageIndex];
                const currentLabel = currentImage.replace('images/', 'labels/').replace(/\.(jpg|jpeg|png)$/i, '.txt');

                // Store current label path for saving
                currentLabelPath = currentLabel;
                saveLastImageSelection(currentImage);

                const loadSeq = ++imageLoadSeq;
                activeImageLoadSeq = loadSeq;

                // Check if label is already preloaded (skip cache if forceReload)
                const cachedLabel = preloadedLabels.get(currentImage);
                if (!forceReload && cachedLabel && !cachedLabel.loading) {
                    // Use cached label - no network request needed
                    labelData = cachedLabel.labelContent || '';
                } else {
                    // Fetch label from server (always fetch on forceReload)
                    const labelUrl = buildLabelUrl(currentImage);
                    const labelResponse = await fetch(labelUrl);
                    const labelResult = await labelResponse.json();
                    labelData = labelResult.labelContent || '';
                    // Update cache with fresh data
                    preloadedLabels.set(currentImage, { loading: false, labelContent: labelData });
                }
                annotations = (parseLabelData(labelData) || []).filter(ann => ann && typeof ann.class !== 'undefined');
                // Detect annotation type from existing labels (set by admin)
                defaultAnnotationType = annotations.some(ann => ann && ann.type === 'obb') ? 'obb' : 'bbox';

                // Show/hide OBB mode section based on detected format
                const obbModeSection = document.getElementById('obbModeSection');
                if (defaultAnnotationType === 'obb') {
                    obbModeSection.style.display = 'block';
                    updateObbModeDisplay(); // Update the display text
                } else {
                    obbModeSection.style.display = 'none';
                }

                // Update instructions based on current format
                updateInstructions();

                setUnsavedChanges(false);
                undoStack = [];
                redoStack = [];
                historySnapshot = null;

                // Cache label info for filtering
                const classes = [...new Set(annotations.filter(ann => ann).map(ann => ann.class))];
                labelCache[currentImage] = {
                    classes: classes,
                    count: annotations.length
                };

                // Check if image is already preloaded
                const cachedImage = preloadedImages.get(currentImage);

                const onImageReady = () => {
                    if (loadSeq !== activeImageLoadSeq) {
                        return;
                    }
                    setupCanvas();
                    document.getElementById('loading').style.display = 'none';
                    canvas.style.display = 'block';
                    showStatusMessage('editor.status.ready');
                    updateUI();
                    preloadAdjacentImages();
                    imageLoadRetryCount.delete(currentImage);
                };

                const onImageError = () => {
                    if (loadSeq !== activeImageLoadSeq) {
                        return;
                    }
                    preloadedImages.delete(currentImage);
                    const retries = imageLoadRetryCount.get(currentImage) || 0;
                    if (retries < 1) {
                        imageLoadRetryCount.set(currentImage, retries + 1);
                        setTimeout(() => {
                            if (imageList[currentImageIndex] === currentImage && loadSeq === activeImageLoadSeq) {
                                loadImage(true);
                            }
                        }, 200);
                        return;
                    }
                    showError(t('editor.status.failedToLoadImage'));
                };

                if (!forceReload && cachedImage && cachedImage.complete && cachedImage.naturalWidth > 0) {
                    // Use the preloaded image directly - no new network request
                    image = cachedImage;
                    onImageReady();
                } else if (!forceReload && cachedImage && !cachedImage.complete) {
                    // Image is still loading, wait for it
                    image = cachedImage;
                    image.onload = onImageReady;
                    image.onerror = onImageError;
                } else {
                    if (forceReload) {
                        imageThumbnails[currentImage] = null;
                    }
                    if (!imageThumbnails[currentImage]) {
                        await preloadImageObjects([currentImage]);
                        if (!imageThumbnails[currentImage]) {
                            await waitForThumbnail(currentImage);
                        }
                    }
                    const dataUrl = imageThumbnails[currentImage];
                    if (!dataUrl) {
                        showError(t('editor.status.failedToLoadImage'));
                        return;
                    }
                    image = new Image();
                    image.onload = onImageReady;
                    image.onerror = onImageError;
                    preloadedImages.set(currentImage, image);
                    image.src = dataUrl;
                }

                const filename = currentImage.split('/').pop();
                document.getElementById('filename').textContent = filename;

                // Update image preview
                updateImagePreview();

            } catch (error) {
                showError(error.message);
            }
        }

        // Build label URL for a given image path
        function buildLabelUrl(imagePath) {
            const labelPath = imagePath.replace('images/', 'labels/').replace(/\.(jpg|jpeg|png)$/i, '.txt');
            if (basePath) {
                return `/api/label-editor/load-label?basePath=${encodeURIComponent(basePath)}&relativeLabel=${encodeURIComponent(labelPath)}`;
            }
            return `/api/label-editor/load-label?label=${encodeURIComponent(labelPath)}`;
        }

        // Build labelCache from preloaded label data for client-side filtering
        function buildLabelCacheFromPreloaded() {
            for (const [imgPath, cached] of preloadedLabels) {
                if (cached.loading) continue;
                const labelContent = cached.labelContent || '';
                const lines = labelContent.trim().split('\n').filter(line => line.trim());
                const classIds = [];
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 5) {
                        const classId = parseInt(parts[0], 10);
                        if (!Number.isNaN(classId)) {
                            classIds.push(classId);
                        }
                    }
                }
                labelCache[imgPath] = {
                    classes: [...new Set(classIds)],
                    count: classIds.length
                };
            }
        }

        // Client-side image filtering using labelCache (mirrors server-side filter-images/route.js)
        function filterImagesLocally(images, filters) {
            const { nameFilter, selectedClasses, minLabels, maxLabels, classMode, classLogic } = filters || {};
            const resolvedClassMode = classMode || 'any';
            const resolvedClassLogic = classLogic || 'any';

            const filteredImages = [];

            for (const imagePath of images) {
                let passFilter = true;

                if (nameFilter && nameFilter.trim()) {
                    if (!imagePath.toLowerCase().includes(nameFilter.toLowerCase().trim())) {
                        passFilter = false;
                    }
                }

                const max = maxLabels !== undefined && maxLabels !== null ? maxLabels : Infinity;
                if (
                    passFilter &&
                    (selectedClasses?.length > 0 || minLabels > 0 || max < Infinity || resolvedClassMode !== 'any')
                ) {
                    const cached = labelCache[imagePath];
                    const classes = cached ? cached.classes : [];
                    const count = cached ? cached.count : 0;

                    const min = minLabels || 0;
                    if (count < min || count > max) {
                        passFilter = false;
                    }

                    if (passFilter) {
                        if (resolvedClassMode === 'none') {
                            if (count !== 0) {
                                passFilter = false;
                            }
                        } else if (resolvedClassMode === 'only') {
                            if (!selectedClasses || selectedClasses.length === 0) {
                                passFilter = false;
                            } else {
                                const hasOnlySelected = classes.every(cls => selectedClasses.includes(cls));
                                if (!hasOnlySelected) {
                                    passFilter = false;
                                } else if (resolvedClassLogic === 'all') {
                                    const hasAllClasses = selectedClasses.every(cls => classes.includes(cls));
                                    if (!hasAllClasses) {
                                        passFilter = false;
                                    }
                                } else {
                                    const hasAnyClass = selectedClasses.some(cls => classes.includes(cls));
                                    if (!hasAnyClass) {
                                        passFilter = false;
                                    }
                                }
                            }
                        } else if (selectedClasses && selectedClasses.length > 0) {
                            if (resolvedClassLogic === 'all') {
                                const hasAllClasses = selectedClasses.every(cls => classes.includes(cls));
                                if (!hasAllClasses) {
                                    passFilter = false;
                                }
                            } else {
                                const hasAnyClass = selectedClasses.some(cls => classes.includes(cls));
                                if (!hasAnyClass) {
                                    passFilter = false;
                                }
                            }
                        }
                    }
                }

                if (passFilter) {
                    filteredImages.push(imagePath);
                }
            }

            return filteredImages;
        }

        // Preload all labels at startup for instant navigation
        async function preloadAllLabels() {
            if (!basePath) return; // Batch API requires basePath

            const BATCH_SIZE = 10000; // Large batch for efficient loading
            const total = allImageList.length;
            let loaded = 0;

            console.log(`Starting to preload ${total} labels...`);
            showStatusMessage('editor.status.preloadingLabels', {
                count: `${loaded}/${total} ${formatProgressBar(loaded, total)}`
            });

            for (let i = 0; i < total; i += BATCH_SIZE) {
                const batch = allImageList.slice(i, Math.min(i + BATCH_SIZE, total));
                // Filter out already loaded labels
                const toLoad = batch.filter(imgPath => !preloadedLabels.has(imgPath));

                if (toLoad.length === 0) {
                    loaded += batch.length;
                    continue;
                }

                // Mark as loading
                toLoad.forEach(imgPath => preloadedLabels.set(imgPath, { loading: true }));

                try {
                    // Single API call for the entire batch
                    const response = await fetch('/api/label-editor/load-labels-batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ basePath, imagePaths: toLoad })
                    });
                    const data = await response.json();

                    // Store all labels from response
                    for (const [imgPath, labelContent] of Object.entries(data.labels || {})) {
                        preloadedLabels.set(imgPath, {
                            loading: false,
                            labelContent: labelContent || ''
                        });
                    }
                    updatePreviewAnnotations();
                } catch (err) {
                    // On error, remove loading markers
                    toLoad.forEach(imgPath => preloadedLabels.delete(imgPath));
                }

                loaded += batch.length;
                showStatusMessage('editor.status.preloadingLabels', {
                    count: `${loaded}/${total} ${formatProgressBar(loaded, total)}`
                });
                console.log(`Preloaded labels: ${loaded}/${total}`);
            }

            console.log(`Finished preloading ${preloadedLabels.size} labels`);

            buildLabelCacheFromPreloaded();
            labelsPreloaded = true;
            console.log(`Label cache built: ${Object.keys(labelCache).length} entries, client-side filtering enabled`);
            showStatusMessage('editor.status.labelsPreloaded');
        }

        // Preload next and previous images and labels for instant navigation
        function preloadAdjacentImages() {
            // Full-dataset preload is always enabled; avoid evicting caches.
            return;
            const PRELOAD_COUNT = labelEditorPreloadCount;
            const preloadIndexes = [];

            if (PRELOAD_COUNT === 0) {
                const keepImagePaths = new Set(imageList);
                let newImageCount = 0;
                const toPreload = imageList.filter((imgPath) => imgPath && !preloadedImages.has(imgPath));
                if (toPreload.length) {
                    preloadImageObjects(toPreload);
                    newImageCount = toPreload.length;
                }
                if (newImageCount > 0) {
                    console.log(`Preload: +${newImageCount} images, -0 evicted (${preloadedImages.size} in cache)`);
                }
                return;
            }

            // Preload images around current position
            // Prioritize forward navigation (more images ahead than behind)
            const backwardCount = Math.floor(PRELOAD_COUNT * 0.3); // 30% backward (6 images)
            const forwardCount = PRELOAD_COUNT - backwardCount;    // 70% forward (14 images)

            // Add backward images
            for (let i = 1; i <= backwardCount; i++) {
                const idx = currentImageIndex - i;
                if (idx >= 0) {
                    preloadIndexes.push(idx);
                }
            }

            // Add forward images
            for (let i = 1; i <= forwardCount; i++) {
                const idx = currentImageIndex + i;
                if (idx < imageList.length) {
                    preloadIndexes.push(idx);
                }
            }

            // Build set of image paths to keep (current + preload range)
            const keepImagePaths = new Set();

            // Always keep current image
            const currentImgPath = imageList[currentImageIndex];
            keepImagePaths.add(currentImgPath);

            // Add preload range to keep set
            preloadIndexes.forEach(idx => {
                keepImagePaths.add(imageList[idx]);
            });

            // Evict images outside preload range to save RAM
            let evictedCount = 0;
            for (const [imgPath, img] of preloadedImages) {
                if (!keepImagePaths.has(imgPath)) {
                    img.onload = null;  // Clear handlers before evicting
                    img.onerror = null;
                    img.src = ''; // Release image data from memory
                    preloadedImages.delete(imgPath);
                    evictedCount++;
                }
            }

            let newImageCount = 0;
            const toPreload = [];
            preloadIndexes.forEach(idx => {
                const imgPath = imageList[idx];
                if (imgPath && !preloadedImages.has(imgPath)) {
                    toPreload.push(imgPath);
                }
            });
            if (toPreload.length) {
                preloadImageObjects(toPreload);
                newImageCount = toPreload.length;
            }
            if (newImageCount > 0 || evictedCount > 0) {
                console.log(`Preload: +${newImageCount} images, -${evictedCount} evicted (${preloadedImages.size} in cache)`);
            }
        }

        function orderPointsClockwiseFromTopLeft(points) {
            const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
            const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;

            const withAngle = points.map(p => ({
                x: p.x,
                y: p.y,
                angle: Math.atan2(p.y - cy, p.x - cx)
            }));

            // Sort by angle and enforce clockwise order in image coordinates (y-down).
            withAngle.sort((a, b) => a.angle - b.angle);
            let ordered = withAngle.map(p => ({ x: p.x, y: p.y }));
            if (signedArea(ordered) < 0) {
                ordered = ordered.reverse();
            }

            // Rotate so the first point is top-left (min y, then min x)
            let startIndex = 0;
            for (let i = 1; i < ordered.length; i++) {
                if (
                    ordered[i].y < ordered[startIndex].y ||
                    (ordered[i].y === ordered[startIndex].y && ordered[i].x < ordered[startIndex].x)
                ) {
                    startIndex = i;
                }
            }

            const rotated = [];
            for (let i = 0; i < ordered.length; i++) {
                const idx = (startIndex + i) % ordered.length;
                rotated.push({ x: ordered[idx].x, y: ordered[idx].y });
            }

            return rotated;
        }

        function signedArea(points) {
            let sum = 0;
            for (let i = 0; i < points.length; i++) {
                const p1 = points[i];
                const p2 = points[(i + 1) % points.length];
                sum += (p1.x * p2.y) - (p2.x * p1.y);
            }
            return sum / 2;
        }

        function ensureClockwisePreserveStart(points) {
            if (signedArea(points) >= 0) {
                return points;
            }
            const reversed = [...points].reverse();
            const start = points[0];
            const startIndex = reversed.indexOf(start);
            if (startIndex === -1) {
                return reversed;
            }
            return reversed.slice(startIndex).concat(reversed.slice(0, startIndex));
        }

        function getObbCenter(points) {
            const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
            const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
            return { x: cx, y: cy };
        }

        function rotatePoints(points, center, angleDelta) {
            const cosA = Math.cos(angleDelta);
            const sinA = Math.sin(angleDelta);
            return points.map(p => {
                const dx = p.x - center.x;
                const dy = p.y - center.y;
                return {
                    x: center.x + dx * cosA - dy * sinA,
                    y: center.y + dx * sinA + dy * cosA
                };
            });
        }

        function rotatePoint(point, center, angleDelta) {
            const cosA = Math.cos(angleDelta);
            const sinA = Math.sin(angleDelta);
            const dx = point.x - center.x;
            const dy = point.y - center.y;
            return {
                x: center.x + dx * cosA - dy * sinA,
                y: center.y + dx * sinA + dy * cosA
            };
        }

        function rectsIntersect(a, b) {
            return a.x < b.x + b.w &&
                a.x + a.w > b.x &&
                a.y < b.y + b.h &&
                a.y + a.h > b.y;
        }

        function getBoundsFromPoints(points) {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            points.forEach(p => {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            });
            return {
                x: minX,
                y: minY,
                w: maxX - minX,
                h: maxY - minY
            };
        }

        function getLabelPosition(anchorX, boxRect, textWidth, labelHeight, labelPadding, totalScale) {
            const margin = 4 / totalScale;
            const labelWidth = textWidth + labelPadding;
            const above = {
                x: anchorX,
                y: boxRect.y - labelHeight - margin,
                w: labelWidth,
                h: labelHeight
            };
            if (!rectsIntersect(above, boxRect) && above.y >= 0) {
                return { x: above.x, y: above.y };
            }
            const below = {
                x: anchorX,
                y: boxRect.y + boxRect.h + margin,
                w: labelWidth,
                h: labelHeight
            };
            if (below.y + below.h <= image.height) {
                return { x: below.x, y: below.y };
            }
            return { x: above.x, y: Math.max(0, above.y) };
        }

        function scaledLineWidth(baseWidth, totalScale) {
            return (baseWidth / totalScale) * lineWidthScale;
        }

        function loadLineWidthScale() {
            const saved = localStorage.getItem('label_editor_line_width_scale');
            if (saved) {
                const value = parseFloat(saved);
                if (!Number.isNaN(value) && value > 0) {
                    lineWidthScale = value;
                }
            }
            const slider = document.getElementById('lineWidthScale');
            const label = document.getElementById('lineWidthScaleValue');
            if (slider) {
                slider.value = lineWidthScale.toFixed(2);
            }
            if (label) {
                label.textContent = `${Math.round(lineWidthScale * 100)}%`;
            }
        }

        function setLineWidthScale(value) {
            const parsed = parseFloat(value);
            if (Number.isNaN(parsed) || parsed <= 0) {
                return;
            }
            lineWidthScale = parsed;
            localStorage.setItem('label_editor_line_width_scale', String(parsed));
            const label = document.getElementById('lineWidthScaleValue');
            if (label) {
                label.textContent = `${Math.round(lineWidthScale * 100)}%`;
            }
            draw();
        }

        function updateSaveButtonState() {
            const saveBtn = document.getElementById('saveBtn');
            if (!saveBtn) return;
            saveBtn.disabled = !hasUnsavedChanges;
            const label = document.getElementById('saveBtnLabel') || saveBtn;
            label.textContent = hasUnsavedChanges ? t('editor.saveLabels') : t('editor.saveNoChanges');
        }

        function scheduleAutoSave() {
            if (autoSaveTimeout) {
                clearTimeout(autoSaveTimeout);
            }
            autoSaveTimeout = setTimeout(async () => {
                autoSaveTimeout = null;
                if (autoSaveInProgress || !hasUnsavedChanges) {
                    return;
                }
                autoSaveInProgress = true;
                try {
                    showStatusMessage('editor.status.savingLabels');
                    await saveLabels(false);
                    showStatusMessage('editor.status.labelsSaved');
                    setTimeout(() => showStatusMessage('editor.status.ready'), 1000);
                } finally {
                    autoSaveInProgress = false;
                }
            }, AUTO_SAVE_DELAY);
        }

        function setUnsavedChanges(value) {
            hasUnsavedChanges = value;
            updateSaveButtonState();
            if (value) {
                scheduleAutoSave();
            } else if (autoSaveTimeout) {
                clearTimeout(autoSaveTimeout);
                autoSaveTimeout = null;
            }
        }

        function formatProgressBar(current, total, width = 20) {
            if (!total || total <= 0) {
                return '';
            }
            const ratio = Math.min(1, Math.max(0, current / total));
            const filled = Math.round(width * ratio);
            const empty = Math.max(0, width - filled);
            const pct = Math.round(ratio * 100);
            return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct}%`;
        }

        async function preloadAllImagesInBatches() {
            const total = allImageList.length;
            if (!total) {
                return;
            }
            const batchSize = labelEditorPreloadCount === 0
                ? total
                : Math.max(1, labelEditorPreloadCount);
            let loaded = 0;
            updateStatusBarRight(t('editor.status.preloadingImages', {
                count: `${loaded}/${total} ${formatProgressBar(loaded, total)}`
            }));
            for (let i = 0; i < total; i += batchSize) {
                const batch = allImageList.slice(i, i + batchSize);
                await preloadImageObjects(batch);
                loaded += batch.length;
                updateStatusBarRight(t('editor.status.preloadingImages', {
                    count: `${loaded}/${total} ${formatProgressBar(loaded, total)}`
                }));
            }
            updateStatusBarRight(t('editor.status.imagesPreloaded'));
            setTimeout(() => updateStatusBarRight(''), 3000);
        }

        function parseLabelData(content) {
            if (!content || typeof content !== 'string' || content.trim() === '') return [];

            try {
                const lines = content.trim().split('\n');
                return lines.map(line => {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 5) return null;

                    const classIdx = parseInt(parts[0]);
                    if (isNaN(classIdx)) return null;

                    if (parts.length >= 9) {
                        const points = [];
                        for (let i = 1; i < 9; i += 2) {
                            points.push({ x: parseFloat(parts[i]), y: parseFloat(parts[i + 1]) });
                        }
                        const ordered = ensureClockwisePreserveStart(points);
                        return {
                            type: 'obb',
                            class: classIdx,
                            points: ordered
                        };
                    }

                    return {
                        type: 'bbox',
                        class: classIdx,
                        x: parseFloat(parts[1]),
                        y: parseFloat(parts[2]),
                        w: parseFloat(parts[3]),
                        h: parseFloat(parts[4])
                    };
                }).filter(a => a !== null);
            } catch (err) {
                console.error('Error parsing label data:', err);
                return [];
            }
        }

        function setupCanvas() {
            // Set canvas internal resolution to match container size
            const container = document.querySelector('.canvas-container');
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;

            // Calculate base scale to fit image to canvas (fill at least one dimension)
            const scaleX = canvas.width / image.width;
            const scaleY = canvas.height / image.height;
            baseScale = Math.min(scaleX, scaleY);

            document.getElementById('imageSize').textContent = `${image.width} x ${image.height}`;
            viewScale = 1;
            viewOffsetX = 0;
            viewOffsetY = 0;
            updateMouseCanvasPointFromClient();
            draw();
        }

        function draw() {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Calculate total scale and centering offset
            const totalScale = baseScale * viewScale;
            const imageWidth = image.width * totalScale;
            const imageHeight = image.height * totalScale;
            const centerX = (canvas.width - imageWidth) / 2;
            const centerY = (canvas.height - imageHeight) / 2;

            // Apply transform: translate to center + pan, then scale, then draw image at origin
            ctx.translate(centerX + viewOffsetX, centerY + viewOffsetY);
            ctx.scale(totalScale, totalScale);
            ctx.drawImage(image, 0, 0);

            // Draw annotations (now in image coordinate space)
            annotations.filter(ann => ann).forEach((ann, idx) => {
                const isSelected = selectedAnnotations.includes(idx);
                const color = getClassColor(ann.class);

                if (ann.type === 'obb') {
                    const points = ann.points.map(p => ({
                        x: p.x * image.width,
                        y: p.y * image.height
                    }));

                    ctx.strokeStyle = color;
                    ctx.lineWidth = scaledLineWidth(isSelected ? 3 : 2, totalScale);
                    ctx.beginPath();
                    ctx.moveTo(points[0].x, points[0].y);
                    for (let i = 1; i < points.length; i++) {
                        ctx.lineTo(points[i].x, points[i].y);
                    }
                    ctx.closePath();
                    ctx.stroke();

                    // Draw label
                    const label = CLASSES[ann.class] || `class_${ann.class}`;
                    const labelPoint = points.reduce((acc, p) => {
                        if (p.y < acc.y || (p.y === acc.y && p.x < acc.x)) return p;
                        return acc;
                    }, points[0]);
                    ctx.fillStyle = color;
                    ctx.font = `${14 / totalScale}px monospace`;
                    const textWidth = ctx.measureText(label).width;
                    const labelHeight = 20 / totalScale;
                    const labelPadding = 8 / totalScale;
                    const obbBounds = getBoundsFromPoints(points);
                    const labelPos = getLabelPosition(labelPoint.x, obbBounds, textWidth, labelHeight, labelPadding, totalScale);
                    ctx.fillRect(labelPos.x, labelPos.y, textWidth + labelPadding, labelHeight);
                    ctx.fillStyle = '#000';
                    ctx.fillText(label, labelPos.x + 4 / totalScale, labelPos.y + labelHeight - 6 / totalScale);

                    if (isSelected) {
                        const handleSize = 8 / totalScale;
                        ctx.fillStyle = color;
                        points.forEach((p) => {
                            ctx.fillRect(p.x - handleSize / 2, p.y - handleSize / 2, handleSize, handleSize);
                        });

                        // Only draw individual rotate handle when single selection
                        if (selectedAnnotations.length === 1) {
                            const topMid = {
                                x: (points[0].x + points[1].x) / 2,
                                y: (points[0].y + points[1].y) / 2
                            };
                            const edgeDx = points[1].x - points[0].x;
                            const edgeDy = points[1].y - points[0].y;
                            let normal = { x: edgeDy, y: -edgeDx };
                            const center = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
                            center.x /= points.length;
                            center.y /= points.length;
                            const toCenter = { x: center.x - topMid.x, y: center.y - topMid.y };
                            if (normal.x * toCenter.x + normal.y * toCenter.y > 0) {
                                normal.x *= -1;
                                normal.y *= -1;
                            }
                            const normalLen = Math.hypot(normal.x, normal.y) || 1;
                            normal.x /= normalLen;
                            normal.y /= normalLen;
                            const handleOffset = 24 / totalScale;
                            const rotHandle = {
                                x: topMid.x + normal.x * handleOffset,
                                y: topMid.y + normal.y * handleOffset
                            };

                            ctx.strokeStyle = color;
                            ctx.lineWidth = scaledLineWidth(2, totalScale);
                            ctx.beginPath();
                            ctx.moveTo(topMid.x, topMid.y);
                            ctx.lineTo(rotHandle.x, rotHandle.y);
                            ctx.stroke();

                            ctx.fillStyle = '#fff';
                            ctx.beginPath();
                            ctx.arc(rotHandle.x, rotHandle.y, 6 / totalScale, 0, Math.PI * 2);
                            ctx.fill();
                            ctx.stroke();
                        }
                    }
                } else {
                    const x = (ann.x - ann.w / 2) * image.width;
                    const y = (ann.y - ann.h / 2) * image.height;
                    const w = ann.w * image.width;
                    const h = ann.h * image.height;

                    // Draw box (scale line width inversely to keep constant visual size)
                    ctx.strokeStyle = color;
                    ctx.lineWidth = scaledLineWidth(isSelected ? 3 : 2, totalScale);
                    ctx.strokeRect(x, y, w, h);

                    // Draw label
                    ctx.fillStyle = color;
                    ctx.font = `${14 / totalScale}px monospace`;
                    const label = CLASSES[ann.class] || `class_${ann.class}`;
                    const textWidth = ctx.measureText(label).width;
                    const labelHeight = 20 / totalScale;
                    const labelPadding = 8 / totalScale;
                    const bboxBounds = { x, y, w, h };
                    const labelPos = getLabelPosition(x, bboxBounds, textWidth, labelHeight, labelPadding, totalScale);
                    ctx.fillRect(labelPos.x, labelPos.y, textWidth + labelPadding, labelHeight);
                    ctx.fillStyle = '#000';
                    ctx.fillText(label, labelPos.x + 4 / totalScale, labelPos.y + labelHeight - 6 / totalScale);

                    // Draw handles if selected
                    if (isSelected) {
                        const handleSize = 8 / totalScale;
                        ctx.fillStyle = color;
                        [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([hx, hy]) => {
                            ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
                        });
                    }
                }
            });

            // Draw group bounding box for multiple selections
            if (selectedAnnotations.length > 1) {
                const groupBox = getGroupBoundingBox();
                if (groupBox) {
                    ctx.strokeStyle = 'rgba(0, 123, 255, 0.8)';
                    ctx.lineWidth = scaledLineWidth(3, totalScale);
                    ctx.setLineDash([8 / totalScale, 4 / totalScale]);
                    ctx.strokeRect(groupBox.x, groupBox.y, groupBox.w, groupBox.h);
                    ctx.setLineDash([]);

                    // Draw corner handles for group resize
                    const handleSize = 10 / totalScale;
                    ctx.fillStyle = 'rgba(0, 123, 255, 0.9)';
                    const corners = [
                        { x: groupBox.x, y: groupBox.y }, // top-left
                        { x: groupBox.x + groupBox.w, y: groupBox.y }, // top-right
                        { x: groupBox.x + groupBox.w, y: groupBox.y + groupBox.h }, // bottom-right
                        { x: groupBox.x, y: groupBox.y + groupBox.h } // bottom-left
                    ];
                    corners.forEach(corner => {
                        ctx.fillRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize);
                    });

                    // Draw group rotate handle
                    const groupRotateInfo = getGroupRotateHandleInfo(groupBox, totalScale);
                    ctx.strokeStyle = 'rgba(0, 123, 255, 0.8)';
                    ctx.lineWidth = scaledLineWidth(2, totalScale);
                    ctx.beginPath();
                    ctx.moveTo(groupRotateInfo.topMid.x, groupRotateInfo.topMid.y);
                    ctx.lineTo(groupRotateInfo.handle.x, groupRotateInfo.handle.y);
                    ctx.stroke();
                    ctx.fillStyle = '#fff';
                    ctx.beginPath();
                    ctx.arc(groupRotateInfo.handle.x, groupRotateInfo.handle.y, 6 / totalScale, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();

                    // Draw label
                    ctx.fillStyle = 'rgba(0, 123, 255, 0.9)';
                    ctx.font = `${14 / totalScale}px monospace`;
                    const label = `${selectedAnnotations.length} selected`;
                    const textWidth = ctx.measureText(label).width;
                    const labelHeight = 20 / totalScale;
                    const labelPadding = 8 / totalScale;
                    ctx.fillRect(groupBox.x, groupBox.y - labelHeight, textWidth + labelPadding, labelHeight);
                    ctx.fillStyle = '#fff';
                    ctx.fillText(label, groupBox.x + 4 / totalScale, groupBox.y - 6 / totalScale);
                }
            }

            // Draw current box being drawn
            if (isDrawing && drawStart && currentBox) {
                ctx.strokeStyle = getClassColor(selectedClass);
                ctx.lineWidth = scaledLineWidth(2, totalScale);
                ctx.setLineDash([5 / totalScale, 5 / totalScale]);
                ctx.strokeRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h);
                ctx.setLineDash([]);
            }

            if (isCreatingObb && obbCreatePoints.length > 0) {
                const color = getClassColor(selectedClass);
                const points = obbCreatePoints.map(p => ({
                    x: p.x * image.width,
                    y: p.y * image.height
                }));
                ctx.strokeStyle = color;
                ctx.lineWidth = scaledLineWidth(2, totalScale);
                ctx.setLineDash([6 / totalScale, 6 / totalScale]);
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x, points[i].y);
                }
                if (obbPreviewPoint) {
                    ctx.lineTo(obbPreviewPoint.x * image.width, obbPreviewPoint.y * image.height);
                }
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = color;
                const handleSize = 8 / totalScale;
                points.forEach((p) => {
                    ctx.fillRect(p.x - handleSize / 2, p.y - handleSize / 2, handleSize, handleSize);
                });
            }

            // Draw 2-point rectangle preview
            if (isCreatingTwoPoint && twoPointFirst && twoPointPreview) {
                const color = getClassColor(selectedClass);
                const x1 = Math.min(twoPointFirst.x, twoPointPreview.x);
                const y1 = Math.min(twoPointFirst.y, twoPointPreview.y);
                const x2 = Math.max(twoPointFirst.x, twoPointPreview.x);
                const y2 = Math.max(twoPointFirst.y, twoPointPreview.y);
                const w = x2 - x1;
                const h = y2 - y1;

                ctx.strokeStyle = color;
                ctx.lineWidth = scaledLineWidth(2, totalScale);
                ctx.setLineDash([6 / totalScale, 6 / totalScale]);
                ctx.strokeRect(x1, y1, w, h);
                ctx.setLineDash([]);

                // Draw first point marker
                ctx.fillStyle = color;
                const markerSize = 8 / totalScale;
                ctx.fillRect(twoPointFirst.x - markerSize / 2, twoPointFirst.y - markerSize / 2, markerSize, markerSize);
            }

            // Draw selection box
            if (isSelectingBox && selectionBoxStart && selectionBoxCurrent) {
                const x1 = Math.min(selectionBoxStart.x, selectionBoxCurrent.x);
                const y1 = Math.min(selectionBoxStart.y, selectionBoxCurrent.y);
                const x2 = Math.max(selectionBoxStart.x, selectionBoxCurrent.x);
                const y2 = Math.max(selectionBoxStart.y, selectionBoxCurrent.y);
                const w = x2 - x1;
                const h = y2 - y1;

                ctx.strokeStyle = 'rgba(0, 123, 255, 0.8)';
                ctx.fillStyle = 'rgba(0, 123, 255, 0.1)';
                ctx.lineWidth = scaledLineWidth(2, totalScale);
                ctx.setLineDash([6 / totalScale, 6 / totalScale]);
                ctx.fillRect(x1, y1, w, h);
                ctx.strokeRect(x1, y1, w, h);
                ctx.setLineDash([]);
            }

            // Draw crosshair based on actual mouse position (avoids stale event state)
            if (lastMouseClient) {
                const rect = canvas.getBoundingClientRect();
                const inside = lastMouseClient.x >= rect.left &&
                    lastMouseClient.x <= rect.right &&
                    lastMouseClient.y >= rect.top &&
                    lastMouseClient.y <= rect.bottom;
                if (inside) {
                    const scaleX = canvas.width / rect.width;
                    const scaleY = canvas.height / rect.height;
                    const cx = (lastMouseClient.x - rect.left) * scaleX;
                    const cy = (lastMouseClient.y - rect.top) * scaleY;
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(cx, 0);
                    ctx.lineTo(cx, canvas.height);
                    ctx.moveTo(0, cy);
                    ctx.lineTo(canvas.width, cy);
                    ctx.stroke();
                }
            }
        }

        function getCanvasPoint(e) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;

            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;

            return { x, y };
        }

        // Convert mouse coordinates from display space to image coordinate space
        function getCanvasCoordinates(e) {
            const point = getCanvasPoint(e);
            const totalScale = baseScale * viewScale;
            const imageWidth = image.width * totalScale;
            const imageHeight = image.height * totalScale;
            const centerX = (canvas.width - imageWidth) / 2;
            const centerY = (canvas.height - imageHeight) / 2;

            // Convert from canvas space to image space
            const x = (point.x - centerX - viewOffsetX) / totalScale;
            const y = (point.y - centerY - viewOffsetY) / totalScale;
            return { x, y };
        }

        function setupEventListeners() {
            canvas.addEventListener('mousedown', handleMouseDown);
            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('mouseup', handleMouseUp);
            canvas.addEventListener('mouseenter', () => {
                showCrosshair = true;
                updateMouseCanvasPointFromClient();
                draw();
            });
            canvas.addEventListener('mouseleave', () => {
                showCrosshair = false;
                mouseCanvasPoint = null;
                draw();
            });
            canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
            canvas.addEventListener('contextmenu', (event) => {
                event.preventDefault();
            });
            document.addEventListener('keydown', handleKeyDown);
            document.addEventListener('keyup', handleKeyUp);
            document.addEventListener('mousemove', (event) => {
                lastMouseClient = { x: event.clientX, y: event.clientY };
                const shouldTrack = isRotating ||
                    isGroupRotating ||
                    isDrawing ||
                    isCreatingObb ||
                    isSelectingBox ||
                    isCreatingTwoPoint ||
                    isDragging ||
                    isMoving;
                if (shouldTrack && event.target !== canvas) {
                    handleMouseMove(event);
                }
            });
            document.addEventListener('mouseup', handleMouseUp);

            // Handle window resize to keep image filling the container
            window.addEventListener('resize', () => {
                updateCanvasDisplaySize();
                updateMouseCanvasPointFromClient();
                draw();
            });

            window.addEventListener('beforeunload', (event) => {
                if (!hasUnsavedChanges) {
                    return;
                }
                event.preventDefault();
                event.returnValue = '';
            });
        }

        function updateCanvasDisplaySize() {
            if (!image) {
                return;
            }

            // Update canvas internal resolution to match container size
            const container = document.querySelector('.canvas-container');
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;

            // Recalculate base scale to fit image to canvas
            const scaleX = canvas.width / image.width;
            const scaleY = canvas.height / image.height;
            baseScale = Math.min(scaleX, scaleY);
        }

        function updateMouseCanvasPointFromClient() {
            if (!lastMouseClient) {
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const inside = lastMouseClient.x >= rect.left &&
                lastMouseClient.x <= rect.right &&
                lastMouseClient.y >= rect.top &&
                lastMouseClient.y <= rect.bottom;
            showCrosshair = inside;
            if (!inside) {
                mouseCanvasPoint = null;
                return;
            }
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            mouseCanvasPoint = {
                x: (lastMouseClient.x - rect.left) * scaleX,
                y: (lastMouseClient.y - rect.top) * scaleY
            };
        }

        function handleMouseDown(e) {
            if (e.button === 2) {
                const point = getCanvasPoint(e);
                isPanning = true;
                panStart = {
                    x: point.x,
                    y: point.y,
                    offsetX: viewOffsetX,
                    offsetY: viewOffsetY
                };
                return;
            }

            if (e.button !== 0) {
                return;
            }

            const { x, y } = getCanvasCoordinates(e);

            // Check if clicking on a handle
            if (selectedAnnotation !== null && selectedAnnotations.length <= 1) {
                const ann = annotations[selectedAnnotation];
                const handle = getHandleAt(ann, x, y);
                if (handle) {
                    historySnapshot = captureState();
                    if (handle.type === 'obb-rotate') {
                        isRotating = true;
                        const center = handle.center;
                        rotateState = {
                            center,
                            startAngle: Math.atan2(y - center.y, x - center.x),
                            startPoints: ann.points.map(p => ({ x: p.x, y: p.y }))
                        };
                    } else {
                        isDragging = true;
                        dragHandle = handle;
                        if (ann.type === 'obb' && handle.type === 'obb') {
                            resizeStart = {
                                handleIndex: handle.index,
                                points: ann.points.map(p => ({ x: p.x, y: p.y }))
                            };
                        }
                    }
                    return;
                }
            }

            // Handle 2-point rectangle creation (second click)
            if (isCreatingTwoPoint && twoPointFirst) {
                const x1 = Math.min(twoPointFirst.x, x);
                const y1 = Math.min(twoPointFirst.y, y);
                const x2 = Math.max(twoPointFirst.x, x);
                const y2 = Math.max(twoPointFirst.y, y);
                const w = x2 - x1;
                const h = y2 - y1;

                // Only create if box is big enough
                if (w > 10 && h > 10) {
                    const prevState = captureState();

                    if (defaultAnnotationType === 'obb') {
                        const points = [
                            { x: x1 / image.width, y: y1 / image.height },
                            { x: x2 / image.width, y: y1 / image.height },
                            { x: x2 / image.width, y: y2 / image.height },
                            { x: x1 / image.width, y: y2 / image.height }
                        ];
                        annotations.push({
                            type: 'obb',
                            class: selectedClass,
                            points: orderPointsClockwiseFromTopLeft(points)
                        });
                    } else {
                        const centerX = (x1 + w / 2) / image.width;
                        const centerY = (y1 + h / 2) / image.height;
                        const normW = w / image.width;
                        const normH = h / image.height;
                        annotations.push({
                            type: 'bbox',
                            class: selectedClass,
                            x: centerX,
                            y: centerY,
                            w: normW,
                            h: normH
                        });
                    }

                    recordHistory(prevState);
                    setUnsavedChanges(true);
                    updateUI();
                }

                clearTwoPointCreation();
                draw();
                return;
            }

            // Handle OBB 4-point mode clicks
            if (defaultAnnotationType === 'obb' && obbCreationMode === '4point' && isCreatingObb) {
                addObbPoint(x, y);
                return;
            }

            // Handle group operations for multiple selections
            if (selectedAnnotations.length > 1) {
                const groupBox = getGroupBoundingBox();
                if (groupBox) {
                    // Check if clicking on group box handles or inside group box
                    const handle = getGroupHandleAt(x, y, groupBox);
                    if (handle) {
                        if (handle.type === 'rotate') {
                            historySnapshot = captureState();
                            isGroupRotating = true;
                            const center = handle.center;
                            groupRotateState = {
                                center,
                                startAngle: Math.atan2(y - center.y, x - center.x),
                                annotations: selectedAnnotations.map(idx => {
                                    const ann = annotations[idx];
                                    if (ann.type === 'obb') {
                                        return { type: 'obb', points: ann.points.map(p => ({ ...p })) };
                                    }
                                    return { type: 'bbox', x: ann.x, y: ann.y, w: ann.w, h: ann.h };
                                })
                            };
                            return;
                        }

                        // Start group resize
                        isDragging = true;
                        dragHandle = handle.name;
                        historySnapshot = captureState();
                        moveStart = {
                            x,
                            y,
                            groupBox: { ...groupBox },
                            annotations: selectedAnnotations.map(idx => {
                                const ann = annotations[idx];
                                if (ann.type === 'obb') {
                                    return { ...ann, points: ann.points.map(p => ({ ...p })) };
                                } else {
                                    return { ...ann };
                                }
                            })
                        };
                        return;
                    } else if (isPointInRect(x, y, groupBox)) {
                        // Check if Shift/Ctrl+click on annotation to toggle selection
                        if (e.shiftKey || e.ctrlKey || e.metaKey) {
                            const clickedIdx = getAnnotationAt(x, y);
                            if (clickedIdx !== null) {
                                const idx = selectedAnnotations.indexOf(clickedIdx);
                                if (idx !== -1) {
                                    // Remove from selection
                                    selectedAnnotations.splice(idx, 1);
                                    selectedAnnotation = selectedAnnotations.length > 0 ? selectedAnnotations[selectedAnnotations.length - 1] : null;
                                    updateUI();
                                    updateClassSelector();
                                    draw();
                                    return;
                                }
                            }
                        }
                        // Start group move
                        historySnapshot = captureState();
                        isMoving = true;
                        moveMoved = false;
                        moveStart = {
                            x,
                            y,
                            groupBox: { ...groupBox },
                            annotations: selectedAnnotations.map(idx => ({ ...annotations[idx] }))
                        };
                        return;
                    }
                }
            }

            const clickedIdx = getAnnotationAt(x, y);
            if (clickedIdx !== null) {
                clearAllCreation();

                // Multi-selection toggle with Ctrl/Cmd or Shift key
                if (e.ctrlKey || e.metaKey || e.shiftKey) {
                    // Toggle selection
                    const idx = selectedAnnotations.indexOf(clickedIdx);
                    if (idx === -1) {
                        // Add to selection
                        selectedAnnotations.push(clickedIdx);
                        selectedAnnotation = clickedIdx; // Keep track of last selected
                    } else {
                        // Remove from selection
                        selectedAnnotations.splice(idx, 1);
                        selectedAnnotation = selectedAnnotations.length > 0 ? selectedAnnotations[selectedAnnotations.length - 1] : null;
                    }
                    updateUI();
                    updateClassSelector();
                    draw();
                    return;
                }

                // Single selection (normal click)
                selectedAnnotation = clickedIdx;
                selectedAnnotations = [clickedIdx];
                updateUI();
                updateClassSelector();
                historySnapshot = captureState();
                isMoving = true;
                moveMoved = false;
                moveStart = {
                    x,
                    y,
                    ann: cloneAnnotations([annotations[clickedIdx]])[0]
                };
                pendingSelection = clickedIdx;
                return;
            }

            if (!e.shiftKey && !e.ctrlKey && !e.metaKey && selectedAnnotations.length > 0) {
                selectedAnnotation = null;
                selectedAnnotations = [];
                updateUI();
                draw();
                return;
            }

            // Start OBB 4-point creation
            if (defaultAnnotationType === 'obb' && obbCreationMode === '4point') {
                addObbPoint(x, y);
                return;
            }

            // Start selection box with Shift key (drag to select multiple)
            if (e.shiftKey) {
                isSelectingBox = true;
                selectionBoxStart = { x, y };
                selectionBoxCurrent = { x, y };
                return;
            }

            // Start drawing new annotation (bbox or OBB rectangle mode)
            selectedAnnotation = null;
            selectedAnnotations = [];
            lastHitIndices = [];
            lastHitPoint = null;
            isDrawing = true;
            drawStart = { x, y };
            currentBox = { x, y, w: 0, h: 0 };
            updateClassSelector();
        }

        function handleMouseMove(e) {
            if (isPanning && panStart) {
                const point = getCanvasPoint(e);
                viewOffsetX = panStart.offsetX + (point.x - panStart.x);
                viewOffsetY = panStart.offsetY + (point.y - panStart.y);
                mouseCanvasPoint = point;
                draw();
                return;
            }

            const { x, y } = getCanvasCoordinates(e);
            mouseCanvasPoint = getCanvasPoint(e);

            if (isGroupRotating && groupRotateState) {
                const center = groupRotateState.center;
                const angle = Math.atan2(y - center.y, x - center.x);
                const delta = angle - groupRotateState.startAngle;
                const centerNorm = { x: center.x / image.width, y: center.y / image.height };

                selectedAnnotations.forEach((idx, i) => {
                    const ann = annotations[idx];
                    const original = groupRotateState.annotations[i];
                    if (ann.type === 'obb' && original.type === 'obb') {
                        ann.points = rotatePoints(original.points, centerNorm, delta);
                    } else if (original.type === 'bbox') {
                        const rotatedCenter = rotatePoint({ x: original.x, y: original.y }, centerNorm, delta);
                        ann.x = rotatedCenter.x;
                        ann.y = rotatedCenter.y;
                        ann.w = original.w;
                        ann.h = original.h;
                    }
                });
                draw();
            } else if (isRotating && selectedAnnotation !== null && rotateState) {
                const ann = annotations[selectedAnnotation];
                const angle = Math.atan2(y - rotateState.center.y, x - rotateState.center.x);
                const delta = angle - rotateState.startAngle;
                const centerNorm = { x: rotateState.center.x / image.width, y: rotateState.center.y / image.height };
                ann.points = rotatePoints(rotateState.startPoints, centerNorm, delta);
                draw();
            } else if (isDragging && dragHandle) {
                if (selectedAnnotations.length > 1 && moveStart && moveStart.groupBox) {
                    // Group resize
                    resizeGroup(moveStart.groupBox, dragHandle, x, y);
                } else if (selectedAnnotation !== null) {
                    // Single annotation resize
                    const ann = annotations[selectedAnnotation];
                    resizeAnnotation(ann, dragHandle, x, y);
                }
                draw();
            } else if (isMoving && moveStart) {
                const dx = x - moveStart.x;
                const dy = y - moveStart.y;
                moveMoved = moveMoved || Math.abs(dx) > 1 || Math.abs(dy) > 1;

                if (selectedAnnotations.length > 1 && moveStart.groupBox) {
                    // Group move - move all selected annotations
                    const deltaX = dx / image.width;
                    const deltaY = dy / image.height;

                    selectedAnnotations.forEach((idx, i) => {
                        const ann = annotations[idx];
                        const original = moveStart.annotations[i];

                        if (ann.type === 'obb') {
                            ann.points = original.points.map(p => ({
                                x: p.x + deltaX,
                                y: p.y + deltaY
                            }));
                        } else {
                            ann.x = original.x + deltaX;
                            ann.y = original.y + deltaY;
                        }
                    });
                } else if (selectedAnnotation !== null) {
                    // Single annotation move
                    const deltaX = dx / image.width;
                    const deltaY = dy / image.height;
                    const ann = annotations[selectedAnnotation];
                    if (ann.type === 'obb') {
                        ann.points = moveStart.ann.points.map(p => ({
                            x: p.x + deltaX,
                            y: p.y + deltaY
                        }));
                    } else {
                        ann.x = moveStart.ann.x + deltaX;
                        ann.y = moveStart.ann.y + deltaY;
                    }
                }
                draw();
            } else if (isCreatingObb) {
                obbPreviewPoint = { x: x / image.width, y: y / image.height };
                draw();
            } else if (isSelectingBox && selectionBoxStart) {
                selectionBoxCurrent = { x, y };
                draw();
            } else if (isCreatingTwoPoint) {
                twoPointPreview = { x, y };
                draw();
            } else if (isDrawing) {
                currentBox.w = x - drawStart.x;
                currentBox.h = y - drawStart.y;
                draw();
            } else {
                draw();
            }
        }

        function handleMouseUp(e) {
            if (isPanning) {
                isPanning = false;
                panStart = null;
                return;
            }

            const { x, y } = getCanvasCoordinates(e);

            if (isSelectingBox && selectionBoxStart) {
                // Complete selection box
                const x1 = Math.min(selectionBoxStart.x, x);
                const y1 = Math.min(selectionBoxStart.y, y);
                const x2 = Math.max(selectionBoxStart.x, x);
                const y2 = Math.max(selectionBoxStart.y, y);

                // Find all annotations inside the selection box
                const selectedIndices = [];
                annotations.forEach((ann, idx) => {
                    if (ann && isAnnotationInBox(ann, x1, y1, x2, y2)) {
                        selectedIndices.push(idx);
                    }
                });

                // Update selection
                if (e.ctrlKey || e.metaKey) {
                    // Add to existing selection
                    selectedIndices.forEach(idx => {
                        if (!selectedAnnotations.includes(idx)) {
                            selectedAnnotations.push(idx);
                        }
                    });
                } else {
                    // Replace selection
                    selectedAnnotations = selectedIndices;
                }

                selectedAnnotation = selectedAnnotations.length > 0 ? selectedAnnotations[selectedAnnotations.length - 1] : null;
                isSelectingBox = false;
                selectionBoxStart = null;
                selectionBoxCurrent = null;
                updateUI();
                draw();
                return;
            }

            if (isGroupRotating) {
                isGroupRotating = false;
                groupRotateState = null;
                recordHistory(historySnapshot);
                historySnapshot = null;
                setUnsavedChanges(true);
                updateUI();
            } else if (isRotating) {
                isRotating = false;
                rotateState = null;
                recordHistory(historySnapshot);
                historySnapshot = null;
                setUnsavedChanges(true);
                updateUI();
            } else if (isDragging) {
                isDragging = false;
                dragHandle = null;
                resizeStart = null;
                recordHistory(historySnapshot);
                historySnapshot = null;
                setUnsavedChanges(true);
                updateUI();
            } else if (isMoving) {
                isMoving = false;
                moveStart = null;
                if (moveMoved) {
                    recordHistory(historySnapshot);
                    setUnsavedChanges(true);
                    updateUI();
                } else {
                    const hitIndices = getAnnotationsAtAll(x, y);
                    if (hitIndices.length > 0) {
                        const pointMatches = lastHitPoint &&
                            Math.abs(lastHitPoint.x - x) <= 5 &&
                            Math.abs(lastHitPoint.y - y) <= 5 &&
                            arraysEqual(hitIndices, lastHitIndices);
                        if (pointMatches) {
                            lastHitCycle = (lastHitCycle + 1) % hitIndices.length;
                        } else {
                            lastHitCycle = 0;
                        }
                        selectedAnnotation = hitIndices[lastHitCycle];
                        lastHitIndices = hitIndices;
                        lastHitPoint = { x, y };
                    } else if (pendingSelection !== null) {
                        selectedAnnotation = pendingSelection;
                    }
                    updateUI();
                    updateClassSelector();
                }
                historySnapshot = null;
                pendingSelection = null;
                draw();
            } else if (isDrawing) {
                const w = Math.abs(x - drawStart.x);
                const h = Math.abs(y - drawStart.y);

                // Check if this was a click (not drag) - start 2-point mode
                if (w <= 10 && h <= 10) {
                    // This is a click, not a drag - start 2-point creation
                    isDrawing = false;
                    isCreatingTwoPoint = true;
                    twoPointFirst = { x: drawStart.x, y: drawStart.y };
                    twoPointPreview = { x, y };
                    draw();
                    return;
                }

                // Create box from drag (original behavior)
                if (w > 10 && h > 10) {
                    const prevState = captureState();
                    const x1 = Math.min(drawStart.x, x);
                    const y1 = Math.min(drawStart.y, y);

                    if (defaultAnnotationType === 'obb') {
                        const points = [
                            { x: x1 / image.width, y: y1 / image.height },
                            { x: (x1 + w) / image.width, y: y1 / image.height },
                            { x: (x1 + w) / image.width, y: (y1 + h) / image.height },
                            { x: x1 / image.width, y: (y1 + h) / image.height }
                        ];
                        annotations.push({
                            type: 'obb',
                            class: selectedClass,
                            points: orderPointsClockwiseFromTopLeft(points)
                        });
                    } else {
                        const centerX = (x1 + w / 2) / image.width;
                        const centerY = (y1 + h / 2) / image.height;
                        const normW = w / image.width;
                        const normH = h / image.height;

                        annotations.push({
                            type: 'bbox',
                            class: selectedClass,
                            x: centerX,
                            y: centerY,
                            w: normW,
                            h: normH
                        });
                    }

                    recordHistory(prevState);
                    setUnsavedChanges(true);
                    updateUI();
                    pendingSelection = null;
                } else if (pendingSelection !== null) {
                    const hitIndices = getAnnotationsAtAll(x, y);
                    if (hitIndices.length > 0) {
                        const pointMatches = lastHitPoint &&
                            Math.abs(lastHitPoint.x - x) <= 5 &&
                            Math.abs(lastHitPoint.y - y) <= 5 &&
                            arraysEqual(hitIndices, lastHitIndices);
                        if (pointMatches) {
                            lastHitCycle = (lastHitCycle + 1) % hitIndices.length;
                        } else {
                            lastHitCycle = 0;
                        }
                        selectedAnnotation = hitIndices[lastHitCycle];
                        lastHitIndices = hitIndices;
                        lastHitPoint = { x, y };
                    } else {
                        selectedAnnotation = pendingSelection;
                    }
                    updateUI();
                    updateClassSelector();
                }

                isDrawing = false;
                drawStart = null;
                currentBox = null;
                pendingSelection = null;
                draw();
            }
        }

        function handleCanvasWheel(e) {
            e.preventDefault();

            const zoomFactor = Math.exp(-e.deltaY * 0.0015);
            const nextScale = Math.min(5, Math.max(0.2, viewScale * zoomFactor));
            if (nextScale === viewScale) {
                return;
            }

            // Get mouse position in canvas coordinates
            const point = getCanvasPoint(e);

            // Calculate current mouse position in image space
            const totalScale = baseScale * viewScale;
            const imageWidth = image.width * totalScale;
            const imageHeight = image.height * totalScale;
            const centerX = (canvas.width - imageWidth) / 2;
            const centerY = (canvas.height - imageHeight) / 2;
            const imageX = (point.x - centerX - viewOffsetX) / totalScale;
            const imageY = (point.y - centerY - viewOffsetY) / totalScale;

            // Update scale
            viewScale = nextScale;

            // Calculate new total scale and centering
            const newTotalScale = baseScale * viewScale;
            const newImageWidth = image.width * newTotalScale;
            const newImageHeight = image.height * newTotalScale;
            const newCenterX = (canvas.width - newImageWidth) / 2;
            const newCenterY = (canvas.height - newImageHeight) / 2;

            // Adjust pan offset so the image point under the mouse stays under the mouse
            viewOffsetX = point.x - newCenterX - imageX * newTotalScale;
            viewOffsetY = point.y - newCenterY - imageY * newTotalScale;

            draw();
        }

        function handleKeyDown(e) {
            // Disable hotkeys when typing in input fields
            const activeElement = document.activeElement;
            const isTyping = activeElement && (
                activeElement.tagName === 'INPUT' ||
                activeElement.tagName === 'TEXTAREA' ||
                activeElement.isContentEditable
            );

            const keyIs = (event, code, keyLower) => {
                if (event.code === code) {
                    return true;
                }
                if (typeof event.key !== 'string') {
                    return false;
                }
                return event.key.toLowerCase() === keyLower;
            };

            if ((e.ctrlKey || e.metaKey) && keyIs(e, 'KeyS', 's')) {
                e.preventDefault();
                saveLabels(true);
                return;
            }

            // Helper: check if any text is selected (page text or input/textarea)
            function hasTextSelection() {
                const sel = window.getSelection();
                if (sel && sel.toString().length > 0) return true;
                if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                    if (typeof activeElement.selectionStart === 'number' && activeElement.selectionStart !== activeElement.selectionEnd) {
                        return true;
                    }
                }
                return false;
            }

            // Ctrl+C: text selection has priority over annotation copy
            if ((e.ctrlKey || e.metaKey) && keyIs(e, 'KeyC', 'c')) {
                if (hasTextSelection()) {
                    return; // Let browser handle text copy
                }
                e.preventDefault();
                copySelectedAnnotations();
                return;
            }

            // Ctrl+V: let browser handle paste in inputs, otherwise paste annotations
            if ((e.ctrlKey || e.metaKey) && keyIs(e, 'KeyV', 'v')) {
                if (isTyping) {
                    return; // Let browser paste into input
                }
                e.preventDefault();
                pasteAnnotations();
                return;
            }

            // Allow Delete/Backspace and standard text shortcuts in inputs
            if (isTyping) {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                    return;
                }
                if ((e.ctrlKey || e.metaKey) && ['x', 'a', 'z'].includes(e.key.toLowerCase())) {
                    return;
                }
                return;
            }

            if (keyIs(e, 'KeyQ', 'q') || keyIs(e, 'KeyE', 'e')) {
                e.preventDefault();
                const delta = keyIs(e, 'KeyQ', 'q') ? -Math.PI / 36 : Math.PI / 36;
                rotateSelectionBy(delta);
                return;
            }

            if (e.key === 'Escape') {
                if (isCreatingObb || isCreatingTwoPoint || isSelectingBox) {
                    e.preventDefault();
                    clearAllCreation();
                    isSelectingBox = false;
                    selectionBoxStart = null;
                    selectionBoxCurrent = null;
                    draw();
                    return;
                }
                // Clear selection if annotations are selected
                if (selectedAnnotations.length > 0) {
                    e.preventDefault();
                    selectedAnnotation = null;
                    selectedAnnotations = [];
                    updateUI();
                    draw();
                    return;
                }
            }

            // Select all annotations
            if ((e.ctrlKey || e.metaKey) && keyIs(e, 'KeyA', 'a')) {
                e.preventDefault();
                selectedAnnotations = annotations.map((_, idx) => idx);
                selectedAnnotation = selectedAnnotations.length > 0 ? selectedAnnotations[selectedAnnotations.length - 1] : null;
                updateUI();
                draw();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && keyIs(e, 'KeyZ', 'z')) {
                e.preventDefault();
                if (e.shiftKey) {
                    redoAction();
                } else {
                    undoAction();
                }
                return;
            }

            // Delete annotation(s)
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedAnnotations.length > 0) {
                    e.preventDefault();
                    deleteSelectedAnnotations();
                }
            }

            // Switch class with W/S keys
            if (keyIs(e, 'KeyW', 'w')) {
                e.preventDefault();
                if (selectedAnnotations.length > 0 && annotations[selectedAnnotations[0]]) {
                    // Change class of all selected annotations
                    const currentClass = annotations[selectedAnnotations[0]].class;
                    const newClass = (currentClass - 1 + CLASSES.length) % CLASSES.length;
                    changeMultipleAnnotationsClass(selectedAnnotations, newClass);
                } else if (selectedAnnotation !== null && annotations[selectedAnnotation]) {
                    // Change class of single selected annotation
                    const currentClass = annotations[selectedAnnotation].class;
                    const newClass = (currentClass - 1 + CLASSES.length) % CLASSES.length;
                    changeAnnotationClass(selectedAnnotation, newClass);
                } else {
                    // Change selected class for new annotations
                    selectedClass = (selectedClass - 1 + CLASSES.length) % CLASSES.length;
                    updateClassSelector();
                }
            } else if (keyIs(e, 'KeyS', 's')) {
                e.preventDefault();
                if (selectedAnnotations.length > 0 && annotations[selectedAnnotations[0]]) {
                    // Change class of all selected annotations
                    const currentClass = annotations[selectedAnnotations[0]].class;
                    const newClass = (currentClass + 1) % CLASSES.length;
                    changeMultipleAnnotationsClass(selectedAnnotations, newClass);
                } else if (selectedAnnotation !== null && annotations[selectedAnnotation]) {
                    // Change class of single selected annotation
                    const currentClass = annotations[selectedAnnotation].class;
                    const newClass = (currentClass + 1) % CLASSES.length;
                    changeAnnotationClass(selectedAnnotation, newClass);
                } else {
                    // Change selected class for new annotations
                    selectedClass = (selectedClass + 1) % CLASSES.length;
                    updateClassSelector();
                }
            }

            // Toggle selection of current image
            if (keyIs(e, 'KeyX', 'x')) {
                e.preventDefault();
                if (imageList.length > 0 && imageList[currentImageIndex]) {
                    toggleImageSelection(imageList[currentImageIndex]);
                }
                return;
            }

            // Navigate between images with arrow keys or A/D keys
            if (e.key === 'ArrowLeft' || keyIs(e, 'KeyA', 'a') ||
                e.key === 'ArrowRight' || keyIs(e, 'KeyD', 'd')) {
                e.preventDefault();
                const isBack = e.key === 'ArrowLeft' || keyIs(e, 'KeyA', 'a');

                // First press (not a repeat): navigate normally
                if (navKeyHeldSince === null) {
                    navKeyHeldSince = Date.now();
                    navKeyHeld = false;
                    if (isBack) {
                        previousImage();
                    } else {
                        nextImage();
                    }
                } else if (!navKeyHeld) {
                    // Key repeating — check if past threshold
                    if (Date.now() - navKeyHeldSince >= NAV_KEY_HOLD_THRESHOLD) {
                        navKeyHeld = true;
                    } else {
                        // Still within threshold, allow navigation
                        if (isBack) {
                            previousImage();
                        } else {
                            nextImage();
                        }
                    }
                }

                if (navKeyHeld) {
                    // Past threshold: advance index only, no loading
                    if (isBack && currentImageIndex > 0) {
                        currentImageIndex--;
                    } else if (!isBack && currentImageIndex < imageList.length - 1) {
                        currentImageIndex++;
                    }
                    updateNavigationButtons();
                    updateImagePreview();
                }
            }
        }

        function handleKeyUp(e) {
            const keyIs = (event, code, keyLower) => {
                if (event.code === code) {
                    return true;
                }
                if (typeof event.key !== 'string') {
                    return false;
                }
                return event.key.toLowerCase() === keyLower;
            };

            if (e.key === 'ArrowLeft' || keyIs(e, 'KeyA', 'a') ||
                e.key === 'ArrowRight' || keyIs(e, 'KeyD', 'd')) {
                if (navKeyHeld) {
                    // Key was held — load the image at the final index
                    loadImage();
                }
                navKeyHeldSince = null;
                navKeyHeld = false;
            }
        }

        function isPointInPolygon(point, polygon) {
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                const xi = polygon[i].x, yi = polygon[i].y;
                const xj = polygon[j].x, yj = polygon[j].y;

                const intersect = ((yi > point.y) !== (yj > point.y)) &&
                    (point.x < (xj - xi) * (point.y - yi) / (yj - yi + 1e-12) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }

        function getAnnotationAt(x, y) {
            for (let i = annotations.length - 1; i >= 0; i--) {
                const ann = annotations[i];
                if (ann.type === 'obb') {
                    const polygon = ann.points.map(p => ({
                        x: p.x * image.width,
                        y: p.y * image.height
                    }));
                    if (isPointInPolygon({ x, y }, polygon)) {
                        return i;
                    }
                } else {
                    const ax = (ann.x - ann.w / 2) * image.width;
                    const ay = (ann.y - ann.h / 2) * image.height;
                    const aw = ann.w * image.width;
                    const ah = ann.h * image.height;

                    if (x >= ax && x <= ax + aw && y >= ay && y <= ay + ah) {
                        return i;
                    }
                }
            }
            return null;
        }

        function getAnnotationsAtAll(x, y) {
            const hits = [];
            for (let i = annotations.length - 1; i >= 0; i--) {
                const ann = annotations[i];
                if (ann.type === 'obb') {
                    const polygon = ann.points.map(p => ({
                        x: p.x * image.width,
                        y: p.y * image.height
                    }));
                    if (isPointInPolygon({ x, y }, polygon)) {
                        hits.push(i);
                    }
                } else {
                    const ax = (ann.x - ann.w / 2) * image.width;
                    const ay = (ann.y - ann.h / 2) * image.height;
                    const aw = ann.w * image.width;
                    const ah = ann.h * image.height;

                    if (x >= ax && x <= ax + aw && y >= ay && y <= ay + ah) {
                        hits.push(i);
                    }
                }
            }
            return hits;
        }

        function arraysEqual(a, b) {
            if (a.length !== b.length) {
                return false;
            }
            for (let i = 0; i < a.length; i++) {
                if (a[i] !== b[i]) {
                    return false;
                }
            }
            return true;
        }

        function getHandleAt(ann, x, y) {
            const totalScale = baseScale * viewScale;
            const handleSize = 16 / totalScale;

            if (ann.type === 'obb') {
                const points = ann.points.map(p => ({
                    x: p.x * image.width,
                    y: p.y * image.height
                }));
                const topMid = {
                    x: (points[0].x + points[1].x) / 2,
                    y: (points[0].y + points[1].y) / 2
                };
                const edgeDx = points[1].x - points[0].x;
                const edgeDy = points[1].y - points[0].y;
                let normal = { x: edgeDy, y: -edgeDx };
                const center = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
                center.x /= points.length;
                center.y /= points.length;
                const toCenter = { x: center.x - topMid.x, y: center.y - topMid.y };
                if (normal.x * toCenter.x + normal.y * toCenter.y > 0) {
                    normal.x *= -1;
                    normal.y *= -1;
                }
                const normalLen = Math.hypot(normal.x, normal.y) || 1;
                normal.x /= normalLen;
                normal.y /= normalLen;
                const handleOffset = 24 / totalScale;
                const rotHandle = {
                    x: topMid.x + normal.x * handleOffset,
                    y: topMid.y + normal.y * handleOffset
                };
                if (Math.hypot(x - rotHandle.x, y - rotHandle.y) < handleSize) {
                    const centerNorm = getObbCenter(ann.points);
                    return {
                        type: 'obb-rotate',
                        center: { x: centerNorm.x * image.width, y: centerNorm.y * image.height }
                    };
                }
                for (let i = 0; i < points.length; i++) {
                    const p = points[i];
                    if (Math.abs(x - p.x) < handleSize && Math.abs(y - p.y) < handleSize) {
                        return { type: 'obb', index: i };
                    }
                }
                return null;
            }

            const ax = (ann.x - ann.w / 2) * image.width;
            const ay = (ann.y - ann.h / 2) * image.height;
            const aw = ann.w * image.width;
            const ah = ann.h * image.height;

            const handles = [
                { name: 'tl', x: ax, y: ay },
                { name: 'tr', x: ax + aw, y: ay },
                { name: 'bl', x: ax, y: ay + ah },
                { name: 'br', x: ax + aw, y: ay + ah }
            ];

            for (const handle of handles) {
                if (Math.abs(x - handle.x) < handleSize && Math.abs(y - handle.y) < handleSize) {
                    return { type: 'bbox', name: handle.name };
                }
            }
            return null;
        }

        function resizeAnnotation(ann, handle, mouseX, mouseY) {
            if (ann.type === 'obb' && handle && handle.type === 'obb') {
                if (obbCreationMode === 'rectangle' && resizeStart && resizeStart.handleIndex === handle.index) {
                    const original = resizeStart.points;
                    const oppositeIdx = (handle.index + 2) % 4;
                    const adj1 = (oppositeIdx + 1) % 4;
                    const adj2 = (oppositeIdx + 3) % 4;
                    const opposite = original[oppositeIdx];
                    const uVec = {
                        x: original[adj1].x - opposite.x,
                        y: original[adj1].y - opposite.y
                    };
                    const vVec = {
                        x: original[adj2].x - opposite.x,
                        y: original[adj2].y - opposite.y
                    };
                    const uLen = Math.hypot(uVec.x, uVec.y) || 1;
                    const vLen = Math.hypot(vVec.x, vVec.y) || 1;
                    const u = { x: uVec.x / uLen, y: uVec.y / uLen };
                    const v = { x: vVec.x / vLen, y: vVec.y / vLen };
                    const newCorner = { x: mouseX / image.width, y: mouseY / image.height };
                    const delta = { x: newCorner.x - opposite.x, y: newCorner.y - opposite.y };
                    const lenU = delta.x * u.x + delta.y * u.y;
                    const lenV = delta.x * v.x + delta.y * v.y;
                    const adj1Point = { x: opposite.x + u.x * lenU, y: opposite.y + u.y * lenU };
                    const adj2Point = { x: opposite.x + v.x * lenV, y: opposite.y + v.y * lenV };
                    const cornerPoint = {
                        x: opposite.x + u.x * lenU + v.x * lenV,
                        y: opposite.y + u.y * lenU + v.y * lenV
                    };

                    const nextPoints = original.map(p => ({ x: p.x, y: p.y }));
                    nextPoints[oppositeIdx] = { x: opposite.x, y: opposite.y };
                    nextPoints[adj1] = adj1Point;
                    nextPoints[adj2] = adj2Point;
                    nextPoints[handle.index] = cornerPoint;
                    ann.points = nextPoints;
                    return;
                }

                const idx = handle.index;
                const nextPoints = ann.points.map(p => ({ x: p.x, y: p.y }));
                nextPoints[idx] = { x: mouseX / image.width, y: mouseY / image.height };
                ann.points = nextPoints;
                return;
            }

            if (!handle || handle.type !== 'bbox') {
                return;
            }

            const centerX = ann.x * image.width;
            const centerY = ann.y * image.height;
            const halfW = ann.w * image.width / 2;
            const halfH = ann.h * image.height / 2;

            let x1 = centerX - halfW;
            let y1 = centerY - halfH;
            let x2 = centerX + halfW;
            let y2 = centerY + halfH;

            switch (handle.name) {
                case 'tl':
                    x1 = mouseX;
                    y1 = mouseY;
                    break;
                case 'tr':
                    x2 = mouseX;
                    y1 = mouseY;
                    break;
                case 'bl':
                    x1 = mouseX;
                    y2 = mouseY;
                    break;
                case 'br':
                    x2 = mouseX;
                    y2 = mouseY;
                    break;
            }

            const newCenterX = (x1 + x2) / 2;
            const newCenterY = (y1 + y2) / 2;
            const newW = Math.abs(x2 - x1);
            const newH = Math.abs(y2 - y1);

            ann.x = newCenterX / image.width;
            ann.y = newCenterY / image.height;
            ann.w = newW / image.width;
            ann.h = newH / image.height;
        }

        function deleteAnnotation(idx) {
            const prevState = captureState();
            annotations.splice(idx, 1);
            recordHistory(prevState);
            selectedAnnotation = null;
            selectedAnnotations = [];
            setUnsavedChanges(true);
            updateUI();
            draw();
        }

        function deleteSelectedAnnotations() {
            if (selectedAnnotations.length === 0) return;

            const prevState = captureState();
            // Sort indices in descending order to delete from end to start
            // This prevents index shifting issues
            const sortedIndices = [...selectedAnnotations].sort((a, b) => b - a);

            sortedIndices.forEach(idx => {
                annotations.splice(idx, 1);
            });

            recordHistory(prevState);
            selectedAnnotation = null;
            selectedAnnotations = [];
            setUnsavedChanges(true);
            updateUI();
            draw();
        }

        function isAnnotationInBox(ann, x1, y1, x2, y2) {
            if (!image) return false;

            if (ann.type === 'obb') {
                // Check if any point of the OBB is inside the box
                return ann.points.some(p => {
                    const px = p.x * image.width;
                    const py = p.y * image.height;
                    return px >= x1 && px <= x2 && py >= y1 && py <= y2;
                });
            } else {
                // Bbox - check if center is inside the box
                const centerX = ann.x * image.width;
                const centerY = ann.y * image.height;
                return centerX >= x1 && centerX <= x2 && centerY >= y1 && centerY <= y2;
            }
        }

        function getGroupBoundingBox() {
            if (!image || selectedAnnotations.length === 0) return null;

            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            selectedAnnotations.forEach(idx => {
                const ann = annotations[idx];
                if (ann.type === 'obb') {
                    ann.points.forEach(p => {
                        const px = p.x * image.width;
                        const py = p.y * image.height;
                        minX = Math.min(minX, px);
                        minY = Math.min(minY, py);
                        maxX = Math.max(maxX, px);
                        maxY = Math.max(maxY, py);
                    });
                } else {
                    const halfW = (ann.w * image.width) / 2;
                    const halfH = (ann.h * image.height) / 2;
                    const centerX = ann.x * image.width;
                    const centerY = ann.y * image.height;
                    minX = Math.min(minX, centerX - halfW);
                    minY = Math.min(minY, centerY - halfH);
                    maxX = Math.max(maxX, centerX + halfW);
                    maxY = Math.max(maxY, centerY + halfH);
                }
            });

            return {
                x: minX,
                y: minY,
                w: maxX - minX,
                h: maxY - minY
            };
        }

        function getGroupRotateHandleInfo(groupBox, totalScale) {
            const topMid = {
                x: groupBox.x + groupBox.w / 2,
                y: groupBox.y
            };
            const handleOffset = 24 / totalScale;
            return {
                topMid,
                handle: {
                    x: topMid.x,
                    y: topMid.y - handleOffset
                }
            };
        }

        function getGroupHandleAt(mouseX, mouseY, groupBox) {
            const totalScale = baseScale * viewScale;
            const handleSize = 10 / totalScale;
            const rotateInfo = getGroupRotateHandleInfo(groupBox, totalScale);
            if (Math.hypot(mouseX - rotateInfo.handle.x, mouseY - rotateInfo.handle.y) <= handleSize) {
                return {
                    type: 'rotate',
                    center: {
                        x: groupBox.x + groupBox.w / 2,
                        y: groupBox.y + groupBox.h / 2
                    }
                };
            }
            const corners = [
                { x: groupBox.x, y: groupBox.y, name: 'tl' },
                { x: groupBox.x + groupBox.w, y: groupBox.y, name: 'tr' },
                { x: groupBox.x + groupBox.w, y: groupBox.y + groupBox.h, name: 'br' },
                { x: groupBox.x, y: groupBox.y + groupBox.h, name: 'bl' }
            ];

            for (const corner of corners) {
                if (Math.abs(mouseX - corner.x) <= handleSize && Math.abs(mouseY - corner.y) <= handleSize) {
                    return { type: 'resize', name: corner.name };
                }
            }
            return null;
        }

        function isPointInRect(x, y, rect) {
            return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
        }

        function resizeGroup(originalGroupBox, handle, mouseX, mouseY) {
            if (!moveStart || !moveStart.annotations) return;

            const origBox = originalGroupBox;
            let newX = origBox.x;
            let newY = origBox.y;
            let newW = origBox.w;
            let newH = origBox.h;

            // Calculate new dimensions based on handle
            switch (handle) {
                case 'tl':
                    newX = mouseX;
                    newY = mouseY;
                    newW = origBox.x + origBox.w - mouseX;
                    newH = origBox.y + origBox.h - mouseY;
                    break;
                case 'tr':
                    newY = mouseY;
                    newW = mouseX - origBox.x;
                    newH = origBox.y + origBox.h - mouseY;
                    break;
                case 'br':
                    newW = mouseX - origBox.x;
                    newH = mouseY - origBox.y;
                    break;
                case 'bl':
                    newX = mouseX;
                    newW = origBox.x + origBox.w - mouseX;
                    newH = mouseY - origBox.y;
                    break;
            }

            // Prevent negative dimensions
            if (newW < 10 || newH < 10) return;

            // Calculate scale factors
            const scaleX = newW / origBox.w;
            const scaleY = newH / origBox.h;

            // Apply transformation to all selected annotations
            selectedAnnotations.forEach((idx, i) => {
                const ann = annotations[idx];
                const original = moveStart.annotations[i];

                if (ann.type === 'obb') {
                    ann.points = original.points.map(p => {
                        const px = p.x * image.width;
                        const py = p.y * image.height;
                        // Transform relative to original group box
                        const relX = (px - origBox.x) / origBox.w;
                        const relY = (py - origBox.y) / origBox.h;
                        return {
                            x: (newX + relX * newW) / image.width,
                            y: (newY + relY * newH) / image.height
                        };
                    });
                } else {
                    const cx = original.x * image.width;
                    const cy = original.y * image.height;
                    const w = original.w * image.width;
                    const h = original.h * image.height;

                    // Transform center position
                    const relX = (cx - origBox.x) / origBox.w;
                    const relY = (cy - origBox.y) / origBox.h;

                    ann.x = (newX + relX * newW) / image.width;
                    ann.y = (newY + relY * newH) / image.height;
                    ann.w = (w * scaleX) / image.width;
                    ann.h = (h * scaleY) / image.height;
                }
            });
        }

        function changeAnnotationClass(idx, newClass) {
            if (!annotations[idx]) return;
            const prevState = captureState();
            annotations[idx].class = newClass;
            recordHistory(prevState);
            setUnsavedChanges(true);
            updateUI();
            draw();
        }

        function changeMultipleAnnotationsClass(indices, newClass) {
            if (indices.length === 0) return;
            const prevState = captureState();
            indices.forEach(idx => {
                if (annotations[idx]) annotations[idx].class = newClass;
            });
            recordHistory(prevState);
            setUnsavedChanges(true);
            updateUI();
            draw();
        }

        function addObbPoint(x, y) {
            if (!image) {
                return;
            }
            const point = { x: x / image.width, y: y / image.height };
            if (obbCreatePoints.length === 0) {
                isCreatingObb = true;
            }
            obbCreatePoints.push(point);
            obbPreviewPoint = null;

            if (obbCreatePoints.length === 4) {
                const prevState = captureState();
                const ordered = orderPointsClockwiseFromTopLeft(obbCreatePoints);
                annotations.push({
                    type: 'obb',
                    class: selectedClass,
                    points: ordered
                });
                recordHistory(prevState);
                setUnsavedChanges(true);
                updateUI();
                clearObbCreation();
            }
            draw();
        }

        function clearObbCreation() {
            isCreatingObb = false;
            obbCreatePoints = [];
            obbPreviewPoint = null;
        }

        function clearTwoPointCreation() {
            isCreatingTwoPoint = false;
            twoPointFirst = null;
            twoPointPreview = null;
        }

        function clearAllCreation() {
            clearObbCreation();
            clearTwoPointCreation();
        }

        function updateUI() {
            const list = document.getElementById('annotationsList');
            list.innerHTML = '';

            annotations.filter(ann => ann).forEach((ann, idx) => {
                const item = document.createElement('div');
                item.className = 'annotation-item';
                if (selectedAnnotations.includes(idx)) {
                    item.classList.add('selected');
                }

                const info = document.createElement('div');
                info.className = 'annotation-info';

                const className = document.createElement('div');
                className.className = 'annotation-class';
                className.textContent = CLASSES[ann.class] || `class_${ann.class}`;
                className.style.color = getClassColor(ann.class);

                const coords = document.createElement('div');
                coords.className = 'annotation-coords';
                if (ann.type === 'obb') {
                    const coordText = ann.points
                        .map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)
                        .join(' ');
                    coords.textContent = `obb: ${coordText}`;
                } else {
                    coords.textContent = `x:${ann.x.toFixed(3)} y:${ann.y.toFixed(3)} w:${ann.w.toFixed(3)} h:${ann.h.toFixed(3)}`;
                }

                info.appendChild(className);
                info.appendChild(coords);

                const actions = document.createElement('div');
                actions.className = 'annotation-actions';

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn btn-small btn-danger';
                deleteBtn.textContent = t('editor.annotations.delete');
                deleteBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteAnnotation(idx);
                };

                actions.appendChild(deleteBtn);

                item.appendChild(info);
                item.appendChild(actions);

                item.onclick = (e) => {
                    // Multi-selection with Ctrl/Cmd key
                    if (e.ctrlKey || e.metaKey) {
                        const selIdx = selectedAnnotations.indexOf(idx);
                        if (selIdx === -1) {
                            selectedAnnotations.push(idx);
                            selectedAnnotation = idx;
                        } else {
                            selectedAnnotations.splice(selIdx, 1);
                            selectedAnnotation = selectedAnnotations.length > 0 ? selectedAnnotations[selectedAnnotations.length - 1] : null;
                        }
                    } else {
                        // Single selection
                        selectedAnnotation = idx;
                        selectedAnnotations = [idx];
                    }
                    updateUI();
                    updateClassSelector();
                    draw();
                };

                list.appendChild(item);
            });

            document.getElementById('annotationCount').textContent = annotations.length;
            updateClassSelector();
        }

        function cloneAnnotations(source) {
            return source.map(ann => {
                if (ann.type === 'obb') {
                    return {
                        type: 'obb',
                        class: ann.class,
                        points: ann.points.map(p => ({ x: p.x, y: p.y }))
                    };
                }
                return {
                    type: 'bbox',
                    class: ann.class,
                    x: ann.x,
                    y: ann.y,
                    w: ann.w,
                    h: ann.h
                };
            });
        }

        function captureState() {
            return {
                annotations: cloneAnnotations(annotations),
                selectedAnnotation,
                selectedAnnotations: [...selectedAnnotations],
                selectedClass
            };
        }

        function restoreState(state) {
            annotations = cloneAnnotations(state.annotations);
            selectedAnnotation = state.selectedAnnotation;
            selectedAnnotations = state.selectedAnnotations ? [...state.selectedAnnotations] : [];
            selectedClass = state.selectedClass;
            if (selectedAnnotation !== null && selectedAnnotation >= annotations.length) {
                selectedAnnotation = null;
                selectedAnnotations = [];
            }
            // Filter out invalid indices from selectedAnnotations
            selectedAnnotations = selectedAnnotations.filter(idx => idx < annotations.length);
            setUnsavedChanges(true);
            updateUI();
            draw();
        }

        function annotationsEqual(a, b) {
            if (a.length !== b.length) {
                return false;
            }
            for (let i = 0; i < a.length; i++) {
                const annA = a[i];
                const annB = b[i];
                if (annA.type !== annB.type || annA.class !== annB.class) {
                    return false;
                }
                if (annA.type === 'obb') {
                    if (annA.points.length !== annB.points.length) {
                        return false;
                    }
                    for (let j = 0; j < annA.points.length; j++) {
                        if (annA.points[j].x !== annB.points[j].x || annA.points[j].y !== annB.points[j].y) {
                            return false;
                        }
                    }
                } else {
                    if (
                        annA.x !== annB.x ||
                        annA.y !== annB.y ||
                        annA.w !== annB.w ||
                        annA.h !== annB.h
                    ) {
                        return false;
                    }
                }
            }
            return true;
        }

        function recordHistory(prevState) {
            if (!prevState) {
                return;
            }
            if (annotationsEqual(prevState.annotations, annotations)) {
                return;
            }
            undoStack.push(prevState);
            if (undoStack.length > HISTORY_LIMIT) {
                undoStack.shift();
            }
            redoStack = [];
        }

        function copySelectedAnnotations() {
            const indices = selectedAnnotations.length > 0
                ? selectedAnnotations
                : (selectedAnnotation !== null ? [selectedAnnotation] : []);
            if (indices.length === 0) {
                showStatusMessage('editor.annotations.noLabelsSelected');
                return;
            }
            const copied = indices.map(idx => cloneAnnotations([annotations[idx]])[0]);
            localStorage.setItem(LABEL_CLIPBOARD_KEY, JSON.stringify({
                version: 1,
                annotations: copied
            }));
            pasteCount = 0;
            showStatusMessage('editor.annotations.copied', { count: copied.length });
        }

        function pasteAnnotations() {
            const raw = localStorage.getItem(LABEL_CLIPBOARD_KEY);
            if (!raw) {
                showStatusMessage('editor.annotations.clipboardEmpty');
                return;
            }
            let payload;
            try {
                payload = JSON.parse(raw);
            } catch (error) {
                showStatusMessage('editor.annotations.clipboardInvalid');
                return;
            }
            if (!payload || !Array.isArray(payload.annotations) || payload.annotations.length === 0) {
                showStatusMessage('editor.annotations.clipboardEmpty');
                return;
            }

            const prevState = captureState();
            pasteCount++;
            const PASTE_OFFSET = 0.02;
            const totalOffset = PASTE_OFFSET * pasteCount;
            const pasted = cloneAnnotations(payload.annotations);
            pasted.forEach(ann => {
                if (ann.type === 'obb') {
                    ann.points.forEach(p => { p.x += totalOffset; p.y += totalOffset; });
                } else {
                    ann.x += totalOffset;
                    ann.y += totalOffset;
                }
            });
            const startIndex = annotations.length;
            annotations = annotations.concat(pasted);
            selectedAnnotations = pasted.map((_, i) => startIndex + i);
            selectedAnnotation = selectedAnnotations[selectedAnnotations.length - 1] ?? null;
            recordHistory(prevState);
            setUnsavedChanges(true);
            updateUI();
            updateClassSelector();
            draw();
            showStatusMessage('editor.annotations.pasted', { count: pasted.length });
        }

        function undoAction() {
            if (undoStack.length === 0) {
                return;
            }
            const currentState = captureState();
            const prevState = undoStack.pop();
            redoStack.push(currentState);
            restoreState(prevState);
            showStatusMessage('editor.status.undo');
        }

        function redoAction() {
            if (redoStack.length === 0) {
                return;
            }
            const currentState = captureState();
            const nextState = redoStack.pop();
            undoStack.push(currentState);
            restoreState(nextState);
            showStatusMessage('editor.status.redo');
        }

        function rotateSelectionBy(delta) {
            if (!image) {
                return;
            }
            const indices = selectedAnnotations.length > 0
                ? selectedAnnotations
                : (selectedAnnotation !== null ? [selectedAnnotation] : []);
            if (indices.length === 0) {
                return;
            }

            const prevState = captureState();

            if (indices.length > 1) {
                const groupBox = getGroupBoundingBox();
                if (!groupBox) {
                    return;
                }
                const center = {
                    x: (groupBox.x + groupBox.w / 2) / image.width,
                    y: (groupBox.y + groupBox.h / 2) / image.height
                };
                indices.forEach(idx => {
                    const ann = annotations[idx];
                    if (ann.type === 'obb') {
                        ann.points = rotatePoints(ann.points, center, delta);
                    } else {
                        const rotatedCenter = rotatePoint({ x: ann.x, y: ann.y }, center, delta);
                        ann.x = rotatedCenter.x;
                        ann.y = rotatedCenter.y;
                    }
                });
            } else {
                const ann = annotations[indices[0]];
                if (ann && ann.type === 'obb') {
                    const center = getObbCenter(ann.points);
                    ann.points = rotatePoints(ann.points, center, delta);
                }
            }

            recordHistory(prevState);
            setUnsavedChanges(true);
            updateUI();
            draw();
        }

        async function saveLabels(showMessage = true) {
            try {
                // Prevent saving if no label path is available
                if (!currentLabelPath) return;

                // Skip save if no changes were made (only for auto-save, not explicit save)
                if (!showMessage && !hasUnsavedChanges) return;

                if (showMessage) showStatusMessage('editor.status.savingLabels');

                // Convert annotations to YOLO format
                const yoloContent = annotations.filter(ann => ann).map(ann => {
                    if (ann.type === 'obb') {
                        const ordered = ensureClockwisePreserveStart(ann.points);
                        const coords = ordered
                            .map(p => `${p.x.toFixed(6)} ${p.y.toFixed(6)}`)
                            .join(' ');
                        return `${ann.class} ${coords}`;
                    }
                    return `${ann.class} ${ann.x.toFixed(6)} ${ann.y.toFixed(6)} ${ann.w.toFixed(6)} ${ann.h.toFixed(6)}`;
                }).join('\n');

                // Build save request based on format
                const requestBody = {
                    content: yoloContent
                };

                if (currentJobId) {
                    requestBody.jobId = Number(currentJobId);
                }

                if (basePath && currentLabelPath) {
                    requestBody.basePath = basePath;
                    requestBody.relativeLabelPath = currentLabelPath;
                } else {
                    requestBody.labelPath = currentLabelPath;
                }

                const response = await fetch('/api/label-editor/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || t('editor.errors.failedToSaveLabels'));
                }

                if (showMessage) {
                    showStatusMessage('editor.status.labelsSaved');
                    setTimeout(() => showStatusMessage('editor.status.ready'), 2000);
                }

                // Update label cache for current image
                const currentImage = imageList[currentImageIndex];
                const classes = [...new Set(annotations.filter(ann => ann).map(ann => ann.class))];
                labelCache[currentImage] = {
                    classes: classes,
                    count: annotations.length
                };

                // Update preloaded labels cache with saved content
                preloadedLabels.set(currentImage, {
                    loading: false,
                    labelContent: yoloContent
                });
                updatePreviewAnnotations();

                setUnsavedChanges(false);

            } catch (error) {
                showError(error.message);
            }
        }

        function updateStatusBar(message, color) {
            const el = document.getElementById('statusBarText') || document.getElementById('statusBar');
            if (!el) return;
            el.textContent = message;
            el.style.color = color;
        }

        function updateStatusBarRight(message) {
            const el = document.getElementById('statusBarRight');
            if (!el) return;
            el.textContent = message;
        }

        function showStatus(message) {
            lastStatusKey = null;
            lastStatusParams = null;
            updateStatusBar(message, '#aaa');
        }

        function showStatusMessage(key, params) {
            lastStatusKey = key;
            lastStatusParams = params;
            updateStatusBar(t(key, params), '#aaa');
        }

        function refreshStatusBar() {
            if (lastStatusKey) {
                updateStatusBar(t(lastStatusKey, lastStatusParams), '#aaa');
            }
        }

        function showError(message) {
            // Hide loading and canvas
            document.getElementById('loading').style.display = 'none';
            document.getElementById('canvas').style.display = 'none';

            // Show error message
            const errorEl = document.getElementById('errorMessage');
            errorEl.textContent = `${t('common.error')}: ${message}`;
            errorEl.style.display = 'block';

            lastStatusKey = null;
            lastStatusParams = null;
            updateStatusBar(`${t('common.error')}: ${message}`, '#dc3545');
        }

        let lastImageSaveTimer = null;
        const LAST_IMAGE_SAVE_DELAY = 1500; // Only save if user stays on image for 1.5s

        function saveLastImageSelection(imagePath) {
            if (!basePath || !imagePath) {
                return;
            }

            // Cancel any pending save
            if (lastImageSaveTimer) {
                clearTimeout(lastImageSaveTimer);
            }

            // Delay save - only save if user stays on this image for 1.5s
            lastImageSaveTimer = setTimeout(() => {
                fetch('/api/label-editor/last-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(currentJobId ? {
                        jobId: Number(currentJobId),
                        imagePath: imagePath.split('/').pop()
                    } : {
                        basePath: basePath,
                        imagePath: imagePath.split('/').pop(),
                        instanceName: currentInstanceName
                    })
                }).catch(() => {});  // end currentJobId ternary

                lastImageSaveTimer = null;
            }, LAST_IMAGE_SAVE_DELAY);
        }


        function toggleImageSelectMode() {
            imageSelectMode = !imageSelectMode;
            if (!imageSelectMode) {
                selectedImages.clear();
            }
            updateSelectModeUI();
            updateImagePreview();
        }

        let saveSelectedDebounce = null;
        function persistSelectedImages() {
            if (!currentJobId && !currentInstanceName) return;
            clearTimeout(saveSelectedDebounce);
            saveSelectedDebounce = setTimeout(() => {
                fetch('/api/label-editor/selected-images', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(currentJobId
                        ? { jobId: Number(currentJobId), selectedImages: Array.from(selectedImages).map(p => p.split('/').pop()) }
                        : { name: currentInstanceName, selectedImages: Array.from(selectedImages).map(p => p.split('/').pop()) })
                }).catch(() => {});
            }, 300);
        }

        async function loadSelectedImages() {
            if (!currentJobId && !currentInstanceName) return;
            try {
                const url = currentJobId
                    ? `/api/label-editor/selected-images?jobId=${encodeURIComponent(currentJobId)}`
                    : `/api/label-editor/selected-images?name=${encodeURIComponent(currentInstanceName)}`;
                const resp = await fetch(url);
                if (resp.ok) {
                    const data = await resp.json();
                    if (Array.isArray(data.selectedImages) && data.selectedImages.length > 0) {
                        const savedNames = new Set(data.selectedImages);
                        const matched = allImageList.filter(p => savedNames.has(p.split('/').pop()));
                        if (matched.length === 0) return;
                        selectedImages = new Set(matched);
                        imageSelectMode = true;
                        updateSelectModeUI();
                        updateImagePreview();
                    }
                }
            } catch (err) {
                console.warn('Failed to load selected images:', err);
            }
        }

        function updateSelectModeUI() {
            const actions = document.getElementById('selectModeActions');
            const previewBar = document.getElementById('previewBar');

            if (actions) {
                actions.style.display = imageSelectMode ? 'flex' : 'none';
            }
            if (previewBar) {
                previewBar.classList.toggle('select-mode', imageSelectMode);
            }
            // Always sync the delete button state
            updateDeleteButton();
        }

        function updateDeleteButton() {
            const btn = document.getElementById('deleteSelectedBtn');
            if (!btn) return;
            const count = selectedImages.size;
            btn.disabled = count === 0;
            btn.textContent = t('editor.selectMode.deleteSelected', { count: String(count) });
        }

        function toggleImageSelection(imagePath) {
            if (selectedImages.has(imagePath)) {
                selectedImages.delete(imagePath);
            } else {
                selectedImages.add(imagePath);
            }
            // Auto-enter/exit select mode based on selection
            const shouldBeInSelectMode = selectedImages.size > 0;
            if (shouldBeInSelectMode !== imageSelectMode) {
                imageSelectMode = shouldBeInSelectMode;
                updateSelectModeUI();
            }
            updateDeleteButton();
            updateImagePreview();
            persistSelectedImages();
        }

        function selectAllImages() {
            imageList.forEach(p => selectedImages.add(p));
            imageSelectMode = true;
            updateSelectModeUI();
            updateDeleteButton();
            updateImagePreview();
            persistSelectedImages();
        }

        function deselectAllImages() {
            selectedImages.clear();
            imageSelectMode = false;
            updateSelectModeUI();
            updateDeleteButton();
            updateImagePreview();
            persistSelectedImages();
        }

        async function deleteSelectedImages() {
            if (selectedImages.size === 0) return;

            const count = selectedImages.size;
            const msg = t('editor.selectMode.confirmDelete', { count: String(count) });
            if (!confirm(msg)) return;

            const statusBar = document.getElementById('statusBarText') || document.getElementById('statusBar');
            if (statusBar) statusBar.textContent = t('editor.selectMode.deleting', { count: String(count) });

            try {
                const res = await fetch('/api/label-editor/delete-images', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ basePath, images: Array.from(selectedImages) })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Delete failed');

                // Remove deleted paths from all lists
                const deletedSet = new Set(selectedImages);
                const currentPath = imageList[currentImageIndex];

                allImageList = allImageList.filter(p => !deletedSet.has(p));
                imageList = imageList.filter(p => !deletedSet.has(p));
                filterBaseList = filterBaseList.filter(p => !deletedSet.has(p));

                // Clean caches
                for (const p of deletedSet) {
                    if (imageThumbnails[p]) {
                        URL.revokeObjectURL(imageThumbnails[p]);
                    }
                    delete imageThumbnails[p];
                    delete labelCache[p];
                    delete imageMetaByPath[p];
                }

                // Fix current index
                if (deletedSet.has(currentPath)) {
                    currentImageIndex = Math.min(currentImageIndex, imageList.length - 1);
                    if (currentImageIndex < 0) currentImageIndex = 0;
                    if (imageList.length > 0) {
                        await loadImage();
                    }
                } else {
                    const newIdx = imageList.indexOf(currentPath);
                    if (newIdx >= 0) currentImageIndex = newIdx;
                }

                // Clear selection and exit select mode
                selectedImages.clear();
                imageSelectMode = false;
                updateSelectModeUI();
                updateNavigationButtons();
                updateImagePreview(true);
                updateFilterStats();
                persistSelectedImages();

                if (statusBar) statusBar.textContent = t('editor.selectMode.deleted', { count: String(data.deleted) });
            } catch (err) {
                if (statusBar) statusBar.textContent = t('editor.selectMode.deleteFailed', { error: err.message });
            }
        }

        export {
            initLabelEditor,
            previousImage,
            nextImage,
            goToImageIndex,
            loadImage,
            saveLabels,
            updateSaveButtonState,
            toggleFilterSection,
            applyFiltersDebounced,
            applyFilters,
            clearFilters,
            resetFilterAndSort,
            setLineWidthScale,
            handlePreviewSortChange,
            handlePreviewSearch,
            toggleImageSelectMode,
            selectAllImages,
            deselectAllImages,
            deleteSelectedImages,
            updateDeleteButton
        };
