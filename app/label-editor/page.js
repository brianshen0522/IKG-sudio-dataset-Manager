"use client";

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../_components/LanguageProvider';
import './label-editor.css';

export default function LabelEditorPage() {
  const apiRef = useRef(null);
  const { t, isReady } = useTranslation();
  const [accessState, setAccessState] = useState('checking'); // 'checking' | 'ok' | 'forbidden'
  const [viewerUrl, setViewerUrl] = useState('');

  useEffect(() => {
    if (!isReady) return;

    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('jobId');
    const datasetId = params.get('datasetId');

    const view = params.get('view') || '';
    let configUrl = null;
    if (jobId) {
      configUrl = `/api/label-editor/instance-config?jobId=${encodeURIComponent(jobId)}${view ? `&view=${encodeURIComponent(view)}` : ''}`;
      const viewParams = new URLSearchParams({ jobId });
      if (view) viewParams.set('view', view);
      setViewerUrl(`/viewer?${viewParams.toString()}`);
    } else if (datasetId) {
      configUrl = `/api/label-editor/instance-config?datasetId=${encodeURIComponent(datasetId)}`;
    }

    if (!configUrl) {
      setAccessState('ok');
      return;
    }

    fetch(configUrl).then(async (res) => {
      if (res.status === 403) {
        setAccessState('forbidden');
      } else if (res.ok && jobId) {
        const data = await res.json().catch(() => ({}));
        setAccessState(data.canEdit === false ? 'forbidden' : 'ok');
      } else {
        setAccessState('ok');
      }
    }).catch(() => setAccessState('ok'));
  }, [isReady]);

  useEffect(() => {
    if (!isReady || accessState !== 'ok') {
      return;
    }
    let active = true;
    import('@/lib/label-editor-ui').then((mod) => {
      if (!active) return;
      apiRef.current = mod;
      if (mod.initLabelEditor) {
        mod.initLabelEditor();
      }
    });
    return () => {
      active = false;
    };
  }, [isReady, accessState]);

  useEffect(() => {
    if (apiRef.current?.updateDeleteButton) {
      apiRef.current.updateDeleteButton();
    }
  });

  useEffect(() => {
    if (apiRef.current?.updateSaveButtonState) {
      apiRef.current.updateSaveButtonState();
    }
  }, [t, isReady]);

  const callApi = (method, ...args) => {
    const api = apiRef.current;
    if (!api || typeof api[method] !== 'function') {
      return;
    }
    api[method](...args);
  };

  if (!isReady || accessState === 'checking') {
    return <div style={{ padding: '20px', color: '#aaa' }}>Loading...</div>;
  }

  if (accessState === 'forbidden') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#1a1a2e', color: '#fff', gap: '16px', textAlign: 'center', padding: '20px'
      }}>
        <div style={{ fontSize: '64px', lineHeight: 1 }}>🚫</div>
        <h1 style={{ fontSize: '28px', fontWeight: 700, margin: 0 }}>Access Denied</h1>
        <p style={{ color: '#aaa', margin: 0, maxWidth: '360px' }}>
          You do not have permission to edit this job. Only the assigned user can open the label editor.
        </p>
        <button
          onClick={() => window.history.back()}
          style={{ marginTop: '8px', padding: '10px 24px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '15px' }}
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h1>{t('editor.title')}</h1>
          {viewerUrl && (
            <a
              href={viewerUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary"
              style={{ fontSize: '12px', padding: '4px 10px', textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              {t('manager.openViewer') || 'Open Viewer'}
            </a>
          )}
          <a
            href="/help?page=label-editor"
            className="btn btn-secondary"
            style={{ fontSize: '12px', padding: '4px 10px', textDecoration: 'none', whiteSpace: 'nowrap' }}
          >
            Manual
          </a>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" id="prevBtn" onClick={() => callApi('previousImage')}>
            {t('editor.previous')}
          </button>
          <span id="imageCounter" style={{ margin: '0 15px', color: '#aaa', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <input
              id="imageIndexInput"
              type="text"
              inputMode="numeric"
              style={{ width: '52px', textAlign: 'center', background: 'transparent', border: '1px solid #444', borderRadius: '4px', color: '#aaa', fontSize: '14px', padding: '1px 4px' }}
              onInput={(e) => {
                e.target.value = e.target.value.replace(/\D/g, '');
                const max = parseInt(e.target.dataset.max, 10) || 1;
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) {
                  if (val < 1) e.target.value = 1;
                  else if (val > max) e.target.value = max;
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.target.blur(); callApi('goToImageIndex', parseInt(e.target.value, 10) - 1); return; }
                const allowed = ['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Home','End'];
                if (!allowed.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault();
              }}
              onBlur={(e) => callApi('goToImageIndex', parseInt(e.target.value, 10) - 1)}
              onClick={(e) => e.target.select()}
            />
            <span id="imageCounterTotal" />
          </span>
          <button className="btn btn-secondary" id="nextBtn" onClick={() => callApi('nextImage')}>
            {t('editor.next')}
          </button>
          <button className="btn btn-secondary" onClick={() => callApi('loadImage', true)}>
            {t('editor.reload')}
          </button>
          <button
            className="btn btn-primary"
            id="saveBtn"
            title={t('editor.saveNoChanges')}
            data-tour="editor-save"
            onClick={() => callApi('saveLabels')}
          >
            <span id="saveBtnLabel">{t('editor.saveLabels')}</span>
          </button>
        </div>
      </div>

      <div className="main-container">
        <div className="editor-left">
          <div className="canvas-container" id="canvasContainer" data-tour="editor-canvas">
            <div className="loading" id="loading">
              {t('common.loading')}
            </div>
            <div
              className="error-message"
              id="errorMessage"
              style={{ display: 'none', color: '#dc3545', padding: '20px', textAlign: 'center' }}
            />
            <canvas id="canvas" />
          </div>

          <div className="preview-bar" id="previewBar">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ color: '#aaa', fontSize: '12px' }} id="imagePreviewCount">
                  {t('editor.preview.images')}
                </div>
                <div className="select-mode-actions" id="selectModeActions" style={{ display: 'none' }}>
                  <button className="btn btn-secondary btn-small" onClick={() => callApi('selectAllImages')}>
                    {t('editor.selectMode.selectAll')}
                  </button>
                  <button className="btn btn-secondary btn-small" onClick={() => callApi('deselectAllImages')}>
                    {t('editor.selectMode.deselectAll')}
                  </button>
                  <button className="btn-delete-selected" id="deleteSelectedBtn" onClick={() => callApi('deleteSelectedImages')}>
                    {t('editor.selectMode.deleteSelected', { count: '0' })}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select id="previewSort" className="preview-sort-select" onChange={() => callApi('handlePreviewSortChange')}>
                  <option value="name-asc">{t('editor.preview.nameAsc')}</option>
                  <option value="name-desc">{t('editor.preview.nameDesc')}</option>
                  <option value="created-desc">{t('editor.preview.createdNewest')}</option>
                  <option value="created-asc">{t('editor.preview.createdOldest')}</option>
                </select>
                <button className="btn btn-secondary btn-small" onClick={() => callApi('resetFilterAndSort')}>
                  {t('editor.filter.resetAll')}
                </button>
                <input
                  type="text"
                  id="previewSearch"
                  className="preview-search-input"
                  placeholder={t('editor.preview.searchFilename')}
                  onInput={() => callApi('handlePreviewSearch')}
                />
              </div>
            </div>
            <div className="preview-progress">
              <div className="preview-progress-fill" id="previewProgressFill" />
            </div>
            <div className="image-preview" id="imagePreview" />
          </div>
        </div>

        <div className="sidebar">
          <div className="sidebar-section">
            <h2>{t('editor.imageInfo.title')}</h2>
            <div className="info-field">
              <div className="info-label">{t('editor.imageInfo.filename')}</div>
              <div className="info-value" id="filename">
                -
              </div>
            </div>
            <div className="info-field">
              <div className="info-label">{t('editor.imageInfo.imageSize')}</div>
              <div className="info-value" id="imageSize">
                -
              </div>
            </div>
          </div>

          <div className="sidebar-section" id="obbModeSection" style={{ display: 'none' }}>
            <h2>{t('editor.obbMode.title')}</h2>
            <div className="info-field">
              <div className="info-value" id="obbModeDisplay" style={{ color: '#4ECDC4', fontWeight: 500 }}>
                -
              </div>
            </div>
          </div>

          <div className="sidebar-section">
            <h2>
              {t('editor.selectClass.title')} <span style={{ fontSize: '12px', color: '#aaa' }}>({t('editor.selectClass.hint')})</span>
            </h2>
            <div className="class-selector" id="classSelector" />
          </div>

          <div className="sidebar-section">
            <h2>
              {t('editor.annotations.title')} (<span id="annotationCount">0</span>)
            </h2>
            <div className="annotations-list" id="annotationsList" />
          </div>

          <div className="sidebar-section">
            <h2>{t('editor.display.title')}</h2>
            <div className="line-width-control">
              <label className="filter-label" htmlFor="lineWidthScale">
                {t('editor.display.lineWidth')} <span id="lineWidthScaleValue">66%</span>
              </label>
              <input
                type="range"
                id="lineWidthScale"
                min="0.3"
                max="1.5"
                step="0.05"
                defaultValue="0.66"
                onInput={(event) => callApi('setLineWidthScale', event.target.value)}
              />
            </div>
          </div>

          <div className="sidebar-section filter-section" data-tour="editor-filters">
            <div className="filter-toggle" onClick={() => callApi('toggleFilterSection')}>
              <h2>{t('editor.filter.title')}</h2>
              <span id="filterToggleIcon">▶</span>
            </div>
            <div className="filter-content collapsed" id="filterContent">
              <div className="filter-group">
                <label className="filter-label">{t('editor.filter.imageName')}</label>
                <input
                  type="text"
                  className="filter-input"
                  id="filterName"
                  placeholder={t('editor.filter.searchByFilename')}
                  autoComplete="off"
                  inputMode="text"
                  onInput={() => callApi('applyFiltersDebounced')}
                />
              </div>

              <div className="filter-group">
                <label className="filter-label">{t('editor.filter.hasClasses')}</label>
                <div className="filter-range">
                  <select id="filterClassMode" onChange={() => callApi('applyFilters')}>
                    <option value="any">{t('editor.filter.any')}</option>
                    <option value="none">{t('editor.filter.none')}</option>
                    <option value="only">{t('editor.filter.onlySelected')}</option>
                  </select>
                  <select id="filterClassLogic" onChange={() => callApi('applyFilters')}>
                    <option value="any">{t('editor.filter.matchAny')}</option>
                    <option value="all">{t('editor.filter.matchAll')}</option>
                  </select>
                </div>
                <div className="filter-class-search">
                  <input
                    type="text"
                    id="filterClassSearch"
                    placeholder={t('editor.filter.searchClasses')}
                    autoComplete="off"
                    inputMode="text"
                  />
                </div>
                <div className="filter-class-chips" id="filterClassChips" />
                <div className="filter-checkboxes" id="filterClasses" />
              </div>

              <div className="filter-group">
                <label className="filter-label">{t('editor.filter.labelCount')}</label>
                <div className="filter-range">
                  <input
                    type="number"
                    id="filterMinLabels"
                    placeholder={t('editor.filter.min')}
                    min="0"
                    defaultValue="0"
                    onChange={() => callApi('applyFilters')}
                  />
                  <span>{t('editor.filter.to')}</span>
                  <input
                    type="number"
                    id="filterMaxLabels"
                    placeholder={t('editor.filter.max')}
                    min="0"
                    defaultValue=""
                    onChange={() => callApi('applyFilters')}
                  />
                </div>
              </div>

              <button className="btn-clear-filter" onClick={() => callApi('clearFilters')}>
                {t('editor.filter.clearAll')}
              </button>

              <div className="filter-stats" id="filterStats">
                {t('editor.filter.showingAll')}
              </div>
              <div className="filter-warning" id="filterWarning" style={{ display: 'none' }}>
                {t('editor.filter.minCannotBeGreaterThanMax')}
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className="status-bar" id="statusBar">
        <span id="statusBarText">{t('editor.status.ready')}</span>
        <span id="statusBarRight" style={{ opacity: 0.7 }}></span>
      </div>
    </>
  );
}
