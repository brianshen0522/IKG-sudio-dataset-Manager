'use client';

import '@uiw/react-md-editor/markdown-editor.css';
import '@uiw/react-markdown-preview/markdown.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import AppHeader from '../../_components/AppHeader';
import MdxClientRenderer from '../../_components/MdxClientRenderer';
import { useCurrentUser } from '../../_components/useCurrentUser';
import { getPageLabel } from '@/lib/help-docs';

const MarkdownEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false });

function surroundSelection(textarea, before, after = before) {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const value = textarea.value || '';
  const selected = value.slice(start, end);
  const nextValue = value.slice(0, start) + before + selected + after + value.slice(end);
  const caretStart = start + before.length;
  const caretEnd = caretStart + selected.length;
  return { nextValue, caretStart, caretEnd };
}

function insertBlockAtCursor(textarea, block) {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const value = textarea.value || '';
  const prefix = value && !value.endsWith('\n') ? '\n' : '';
  const suffix = value.slice(end).startsWith('\n') ? '' : '\n';
  const insertion = `${prefix}${block}${suffix}`;
  const nextValue = value.slice(0, start) + insertion + value.slice(end);
  const caret = start + insertion.length;
  return { nextValue, caretStart: caret, caretEnd: caret };
}

export default function AdminDocsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useCurrentUser();
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState({ sectionId: null, lang: 'en' });
  const [form, setForm] = useState({ title: '', summary: '', mdxContent: '' });
  const [saving, setSaving] = useState(false);
  const [revisions, setRevisions] = useState([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [editorMode, setEditorMode] = useState('edit');
  const editorHostRef = useRef(null);

  useEffect(() => {
    if (!authLoading && user?.role !== 'admin') {
      router.replace('/');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (authLoading || user?.role !== 'admin') return;
    loadPages();
  }, [authLoading, user]);

  async function loadPages() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/docs');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load docs');
      setPages(data.pages || []);
      const firstSection = data.pages?.[0]?.sections?.[0];
      if (firstSection) {
        setSelected((prev) => ({
          sectionId: prev.sectionId || firstSection.id,
          lang: prev.lang || 'en',
        }));
      }
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load docs');
    } finally {
      setLoading(false);
    }
  }

  const currentSection = useMemo(() => {
    for (const page of pages) {
      for (const section of page.sections || []) {
        if (section.id === selected.sectionId) return section;
      }
    }
    return null;
  }, [pages, selected.sectionId]);

  useEffect(() => {
    if (!currentSection) return;
    const translation = currentSection.translations?.[selected.lang] || {};
    setForm({
      title: translation.title || '',
      summary: translation.summary || '',
      mdxContent: translation.mdxContent || '',
    });
    setUploadStatus('');
  }, [currentSection, selected.lang]);

  useEffect(() => {
    if (!selected.sectionId) return;
    setRevisionsLoading(true);
    fetch(`/api/admin/docs/sections/${selected.sectionId}/revisions?lang=${encodeURIComponent(selected.lang)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load revisions');
        setRevisions(data.revisions || []);
      })
      .catch(() => setRevisions([]))
      .finally(() => setRevisionsLoading(false));
  }, [selected.sectionId, selected.lang]);

  function getEditorTextarea() {
    return editorHostRef.current?.querySelector('textarea') || null;
  }

  function focusTextareaSelection(start, end) {
    const textarea = getEditorTextarea();
    if (!textarea) return;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, end);
    });
  }

  function applyTextTransform(transform) {
    const textarea = getEditorTextarea();
    if (!textarea) {
      return;
    }
    const { nextValue, caretStart, caretEnd } = transform(textarea);
    setForm((prev) => ({ ...prev, mdxContent: nextValue }));
    focusTextareaSelection(caretStart, caretEnd);
  }

  function insertAssetMarkdown(markdown) {
    applyTextTransform((textarea) => insertBlockAtCursor(textarea, markdown));
  }

  async function uploadAsset(file) {
    if (!file) return;
    setUploading(true);
    setUploadStatus(`Uploading ${file.name}…`);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/admin/docs/assets', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      insertAssetMarkdown(data.asset.markdown);
      setUploadStatus(`Inserted ${data.asset.url}`);
    } catch (err) {
      setUploadStatus(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      setIsDragOver(false);
    }
  }

  async function handleSave() {
    if (!selected.sectionId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/docs/sections/${selected.sectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lang: selected.lang,
          title: form.title,
          summary: form.summary,
          mdxContent: form.mdxContent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      await loadPages();
      setUploadStatus('Saved.');
    } catch (err) {
      alert(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) uploadAsset(file);
  }

  if (authLoading || loading) {
    return (
      <div style={styles.page}>
        <AppHeader title="Docs Editor" />
        <div style={styles.loading}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <AppHeader title="Docs Editor" />
      <main style={styles.main}>
        <aside style={styles.sidebar}>
          <h1 style={styles.sidebarTitle}>Docs Editor</h1>
          {error ? <div style={styles.error}>{error}</div> : null}
          {pages.map((page) => (
            <div key={page.pageKey} style={{ marginBottom: '14px' }}>
              <div style={styles.pageLabel}>{getPageLabel(page.pageKey, 'en')}</div>
              <div style={styles.sectionList}>
                {page.sections.map((section) => (
                  <button
                    key={section.id}
                    style={{
                      ...styles.sectionButton,
                      ...(selected.sectionId === section.id ? styles.sectionButtonActive : {}),
                    }}
                    onClick={() => setSelected((prev) => ({ ...prev, sectionId: section.id }))}
                  >
                    <span>{section.translations?.en?.title || section.slug}</span>
                    <small style={styles.sectionMeta}>{section.audienceRole}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <section style={styles.editor}>
          {currentSection ? (
            <>
              <div style={styles.editorTop}>
                <div>
                  <h2 style={styles.editorTitle}>{currentSection.translations?.en?.title || currentSection.slug}</h2>
                  <div style={styles.editorMeta}>
                    <span>{currentSection.pageKey}</span>
                    <span>/</span>
                    <span>{currentSection.audienceRole}</span>
                  </div>
                </div>
                <div style={styles.topActions}>
                  <div style={styles.langTabs}>
                    {['en', 'zh-TW'].map((lang) => (
                      <button
                        key={lang}
                        style={{
                          ...styles.langTab,
                          ...(selected.lang === lang ? styles.langTabActive : {}),
                        }}
                        onClick={() => setSelected((prev) => ({ ...prev, lang }))}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                  <button style={styles.saveBtn} onClick={handleSave} disabled={saving || !form.title.trim()}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              <div style={styles.editorGrid}>
                <div style={styles.formPanel}>
                  <label style={styles.label}>Title</label>
                  <input
                    style={styles.input}
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  />

                  <label style={styles.label}>Summary</label>
                  <textarea
                    style={{ ...styles.input, minHeight: '70px' }}
                    value={form.summary}
                    onChange={(e) => setForm((prev) => ({ ...prev, summary: e.target.value }))}
                  />

                  <div style={styles.editorToolbar}>
                    <div style={styles.toolbarGroup}>
                      <button style={styles.toolBtn} onClick={() => applyTextTransform((textarea) => surroundSelection(textarea, '**'))}>Bold</button>
                      <button style={styles.toolBtn} onClick={() => applyTextTransform((textarea) => surroundSelection(textarea, '*'))}>Italic</button>
                      <button style={styles.toolBtn} onClick={() => applyTextTransform((textarea) => insertBlockAtCursor(textarea, '## Heading'))}>Heading</button>
                      <button style={styles.toolBtn} onClick={() => applyTextTransform((textarea) => insertBlockAtCursor(textarea, '- item 1\n- item 2'))}>List</button>
                      <button style={styles.toolBtn} onClick={() => applyTextTransform((textarea) => insertBlockAtCursor(textarea, '```mdx\ncode here\n```'))}>Code</button>
                    </div>
                    <div style={styles.toolbarGroup}>
                      <button style={styles.toolBtn} onClick={() => applyTextTransform((textarea) => insertBlockAtCursor(textarea, '<Note title="Note">\nWrite note here.\n</Note>'))}>Note</button>
                      <button style={styles.toolBtn} onClick={() => applyTextTransform((textarea) => insertBlockAtCursor(textarea, '<Warning title="Warning">\nWrite warning here.\n</Warning>'))}>Warning</button>
                      <button style={styles.toolBtn} onClick={() => applyTextTransform((textarea) => insertBlockAtCursor(textarea, '<ScreenshotPlaceholder id="DOC-IMG-page-topic" title="Screenshot title" />'))}>Screenshot</button>
                      <button style={styles.toolBtn} onClick={() => applyTextTransform((textarea) => insertBlockAtCursor(textarea, '<GifPlaceholder id="DOC-GIF-page-flow" title="GIF title" />'))}>GIF Placeholder</button>
                    </div>
                  </div>

                  <div style={styles.assetBar}>
                    <label style={styles.assetUploadBtn}>
                      Upload Image/GIF
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        style={{ display: 'none' }}
                        onChange={(e) => uploadAsset(e.target.files?.[0])}
                      />
                    </label>
                    <button style={styles.modeBtn} onClick={() => setEditorMode((prev) => prev === 'edit' ? 'live' : 'edit')}>
                      {editorMode === 'edit' ? 'Switch to Live Preview' : 'Switch to Edit'}
                    </button>
                    <span style={styles.assetHint}>Drag an image or GIF into the editor area to upload and insert it.</span>
                  </div>

                  <div
                    ref={editorHostRef}
                    style={{
                      ...styles.editorShell,
                      ...(isDragOver ? styles.editorShellDrag : {}),
                    }}
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false);
                    }}
                    onDrop={handleDrop}
                    data-color-mode="dark"
                  >
                    {isDragOver ? <div style={styles.dropOverlay}>Drop image or GIF to upload</div> : null}
                    <MarkdownEditor
                      value={form.mdxContent}
                      onChange={(value) => setForm((prev) => ({ ...prev, mdxContent: value || '' }))}
                      height={540}
                      preview={editorMode}
                      hideToolbar
                      visibleDragbar={false}
                      textareaProps={{
                        placeholder: 'Write MDX here. Drag images/GIFs into this area to upload and insert markdown automatically.',
                      }}
                    />
                  </div>
                  {uploadStatus ? <div style={styles.uploadStatus}>{uploadStatus}</div> : null}
                  {uploading ? <div style={styles.uploadStatus}>Uploading asset…</div> : null}
                </div>

                <div style={styles.previewPanel}>
                  <div style={styles.previewCard}>
                    <h3 style={styles.previewTitle}>Live Preview</h3>
                    <div style={styles.previewMeta}>
                      {selected.lang} · {currentSection.pageKey} · {currentSection.audienceRole}
                    </div>
                    <div style={styles.previewProse}>
                      <h2 style={{ marginTop: 0 }}>{form.title || 'Untitled section'}</h2>
                      {form.summary ? <p style={{ color: '#9ba9c3' }}>{form.summary}</p> : null}
                      <MdxClientRenderer source={form.mdxContent} />
                    </div>
                  </div>

                  <div style={styles.revisionCard}>
                    <h3 style={styles.previewTitle}>Recent Revisions</h3>
                    {revisionsLoading ? (
                      <div style={styles.loading}>Loading revisions…</div>
                    ) : revisions.length === 0 ? (
                      <div style={styles.empty}>No revisions yet.</div>
                    ) : (
                      revisions.map((revision) => (
                        <div key={revision.id} style={styles.revisionRow}>
                          <div style={{ color: '#e6edf7', fontSize: '13px', fontWeight: 700 }}>v{revision.version}</div>
                          <div style={{ color: '#9ba9c3', fontSize: '12px' }}>
                            {revision.editedBy?.username || 'seed'} · {revision.editedAt ? new Date(revision.editedAt).toLocaleString() : '—'}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={styles.empty}>Select a section to edit.</div>
          )}
        </section>
      </main>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#08111f' },
  main: { display: 'grid', gridTemplateColumns: '320px 1fr', minHeight: 'calc(100vh - 56px)' },
  sidebar: { borderRight: '1px solid #1d2b40', padding: '20px', background: '#0d1728', overflowY: 'auto' },
  sidebarTitle: { margin: '0 0 18px', color: '#fff', fontSize: '22px' },
  pageLabel: { color: '#6ea8ff', fontSize: '12px', fontWeight: 800, marginBottom: '8px', textTransform: 'uppercase' },
  sectionList: { display: 'flex', flexDirection: 'column', gap: '8px' },
  sectionButton: { textAlign: 'left', background: '#111c2d', border: '1px solid #25344d', color: '#dce6f5', borderRadius: '10px', padding: '10px 12px', cursor: 'pointer' },
  sectionButtonActive: { borderColor: '#2f7ff5', background: 'rgba(47,127,245,0.14)' },
  sectionMeta: { display: 'block', marginTop: '4px', color: '#7f96b4' },
  editor: { padding: '24px', overflowY: 'auto' },
  editorTop: { display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'flex-start', marginBottom: '18px' },
  editorTitle: { margin: 0, color: '#fff' },
  editorMeta: { display: 'flex', gap: '8px', color: '#8fa4c3', fontSize: '13px', marginTop: '6px' },
  topActions: { display: 'flex', gap: '12px', alignItems: 'center' },
  langTabs: { display: 'flex', gap: '6px' },
  langTab: { background: '#111c2d', border: '1px solid #25344d', color: '#9ba9c3', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer', fontWeight: 700 },
  langTabActive: { borderColor: '#2f7ff5', color: '#fff' },
  saveBtn: { background: '#2f7ff5', border: 'none', color: '#fff', borderRadius: '10px', padding: '10px 16px', cursor: 'pointer', fontWeight: 800 },
  editorGrid: { display: 'grid', gridTemplateColumns: 'minmax(520px, 1.15fr) minmax(360px, 0.85fr)', gap: '20px' },
  formPanel: { background: '#0f192a', border: '1px solid #1f2f46', borderRadius: '16px', padding: '18px' },
  previewPanel: { display: 'flex', flexDirection: 'column', gap: '20px' },
  previewCard: { background: '#0f192a', border: '1px solid #1f2f46', borderRadius: '16px', padding: '18px' },
  revisionCard: { background: '#0f192a', border: '1px solid #1f2f46', borderRadius: '16px', padding: '18px' },
  previewTitle: { margin: '0 0 6px', color: '#fff' },
  previewMeta: { color: '#8fa4c3', fontSize: '12px', marginBottom: '16px' },
  previewProse: { color: '#dce6f5', lineHeight: 1.75 },
  label: { display: 'block', color: '#dce6f5', fontSize: '13px', fontWeight: 700, marginBottom: '6px', marginTop: '14px' },
  input: { width: '100%', boxSizing: 'border-box', background: '#09111d', border: '1px solid #25344d', color: '#dce6f5', borderRadius: '10px', padding: '10px 12px' },
  editorToolbar: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '16px', marginBottom: '12px' },
  toolbarGroup: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  toolBtn: { background: '#132239', border: '1px solid #2c4565', color: '#dce6f5', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 700 },
  assetBar: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' },
  assetUploadBtn: { display: 'inline-flex', alignItems: 'center', background: '#1d4ed8', border: 'none', color: '#fff', borderRadius: '8px', padding: '9px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 800 },
  modeBtn: { background: '#111c2d', border: '1px solid #25344d', color: '#dce6f5', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 700 },
  assetHint: { color: '#8fa4c3', fontSize: '12px' },
  editorShell: { position: 'relative', border: '1px solid #25344d', borderRadius: '12px', overflow: 'hidden', background: '#0a1321' },
  editorShellDrag: { borderColor: '#2f7ff5', boxShadow: '0 0 0 2px rgba(47,127,245,0.18)' },
  dropOverlay: { position: 'absolute', inset: 0, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,17,31,0.82)', color: '#dce6f5', fontSize: '18px', fontWeight: 800, pointerEvents: 'none' },
  uploadStatus: { marginTop: '10px', color: '#9ec3ff', fontSize: '12px' },
  revisionRow: { padding: '10px 0', borderTop: '1px solid #1d2b40' },
  loading: { color: '#9ba9c3', padding: '20px' },
  error: { color: '#fda4af', fontSize: '13px', marginBottom: '10px' },
  empty: { color: '#8fa4c3' },
};
