'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '../_components/AppHeader';
import MdxClientRenderer from '../_components/MdxClientRenderer';
import LanguageSwitcher from '../_components/LanguageSwitcher';
import { useCurrentUser } from '../_components/useCurrentUser';
import { useLanguage } from '../_components/LanguageProvider';
import { getPageLabel, getRoleLabel } from '@/lib/help-docs';

function stripMdx(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`#>*_[\]\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function HelpPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useCurrentUser();
  const { lang, isReady } = useLanguage();
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [locationState, setLocationState] = useState({ page: 'system-overview', section: '' });

  const selectedPage = locationState.page || 'system-overview';
  const selectedSection = locationState.section || '';

  useEffect(() => {
    function syncLocation() {
        const params = new URLSearchParams(window.location.search);
        setLocationState({
        page: params.get('page') || 'system-overview',
        section: params.get('section') || '',
      });
    }

    syncLocation();
    window.addEventListener('popstate', syncLocation);
    return () => window.removeEventListener('popstate', syncLocation);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/docs?lang=${encodeURIComponent(lang)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load docs');
        if (!cancelled) {
          setPages(data.pages || []);
          setError('');
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load docs');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lang, isReady]);

  const selectedPageData = useMemo(() => {
    return pages.find((page) => page.pageKey === selectedPage) || pages[0] || null;
  }, [pages, selectedPage]);

  const searchResults = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return [];

    const results = [];
    for (const page of pages) {
      for (const section of page.sections || []) {
        const haystack = [
          getPageLabel(page.pageKey, lang),
          section.translation?.title,
          section.translation?.summary,
          stripMdx(section.translation?.mdxContent),
        ].join(' ').toLowerCase();
        if (haystack.includes(value)) {
          results.push({
            pageKey: page.pageKey,
            slug: section.slug,
            title: section.translation?.title || section.slug,
            pageLabel: getPageLabel(page.pageKey, lang),
          });
        }
      }
    }
    return results.slice(0, 20);
  }, [pages, query, lang]);

  useEffect(() => {
    if (!selectedSection) return;
    const id = `section-${selectedSection}`;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [selectedPage, selectedSection, pages]);

  function goTo(pageKey, section) {
    const params = new URLSearchParams();
    params.set('page', pageKey);
    if (section) params.set('section', section);
    const href = `/help?${params.toString()}`;
    setLocationState({ page: pageKey, section: section || '' });
    router.replace(href);
  }

  if (authLoading || !isReady) {
    return (
      <div style={styles.page}>
        <AppHeader title="Manual" />
        <div style={styles.loading}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={styles.page} id="top">
      <AppHeader title="User Manual" />
      <main style={styles.main}>
        <aside style={styles.sidebar}>
          <div style={styles.sidebarTop}>
            <div>
              <h1 style={styles.sidebarTitle}>Manual</h1>
              <p style={styles.sidebarMeta}>{getRoleLabel(user?.role, lang)}</p>
            </div>
            <LanguageSwitcher />
          </div>
          <input
            style={styles.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={lang === 'zh-TW' ? '搜尋文件…' : 'Search docs…'}
          />
          {query.trim() ? (
            <div style={styles.searchPanel}>
              {searchResults.length === 0 ? <div style={styles.empty}>No matching sections.</div> : searchResults.map((item) => (
                <button
                  key={`${item.pageKey}:${item.slug}`}
                  style={styles.searchResult}
                  onClick={() => { setQuery(''); goTo(item.pageKey, item.slug); }}
                >
                  <span style={styles.searchResultPage}>{item.pageLabel}</span>
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={styles.pageList}>
              {pages.map((page) => (
                <div key={page.pageKey}>
                  <button
                    style={{
                      ...styles.pageButton,
                      ...(selectedPageData?.pageKey === page.pageKey ? styles.pageButtonActive : {}),
                    }}
                    onClick={() => goTo(page.pageKey)}
                  >
                    {getPageLabel(page.pageKey, lang)}
                  </button>
                  {selectedPageData?.pageKey === page.pageKey && page.sections?.length ? (
                    <div style={styles.sectionList}>
                      {page.sections.map((section) => (
                        <button
                          key={section.key}
                          style={{
                            ...styles.sectionButton,
                            ...(selectedSection === section.slug ? styles.sectionButtonActive : {}),
                          }}
                          onClick={() => goTo(page.pageKey, section.slug)}
                        >
                          {section.translation?.title || section.slug}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </aside>

        <section style={styles.contentWrap}>
          <div style={styles.breadcrumbs}>
            <span>{getRoleLabel(user?.role, lang)}</span>
            <span>/</span>
            <span>{selectedPageData ? getPageLabel(selectedPageData.pageKey, lang) : 'Manual'}</span>
          </div>
          {loading ? (
            <div style={styles.loading}>Loading manual…</div>
          ) : error ? (
            <div style={styles.error}>{error}</div>
          ) : !selectedPageData ? (
            <div style={styles.empty}>No documentation is available for this role.</div>
          ) : (
            <div style={styles.docCard}>
              <div style={styles.docHeader}>
                <div>
                  <h2 style={styles.docTitle}>{getPageLabel(selectedPageData.pageKey, lang)}</h2>
                  <p style={styles.docSubtitle}>
                    {lang === 'zh-TW' ? '只顯示目前角色需要的頁面，shared 內容僅限真正共用的操作。' : 'Only pages relevant to the current role are shown. Shared content is limited to workflows that are actually the same.'}
                  </p>
                </div>
                <a href="#top" style={styles.backTop}>Back to top</a>
              </div>

              {(selectedPageData.sections || []).map((section) => (
                <article key={section.key} id={`section-${section.slug}`} style={styles.sectionCard}>
                  <div style={styles.sectionTop}>
                    <div>
                      <h3 style={styles.sectionTitle}>{section.translation?.title}</h3>
                      {section.translation?.summary ? <p style={styles.sectionSummary}>{section.translation.summary}</p> : null}
                    </div>
                    <button
                      type="button"
                      style={styles.anchorBtn}
                      onClick={() => goTo(selectedPageData.pageKey, section.slug)}
                      title="Copy section link"
                    >
                      #
                    </button>
                  </div>
                  <div style={styles.metaRow}>
                    <span>{lang === 'zh-TW' ? '最後更新' : 'Last updated'}: {section.translation?.lastUpdatedAt ? new Date(section.translation.lastUpdatedAt).toLocaleString() : '—'}</span>
                    <span>{lang === 'zh-TW' ? '更新者' : 'Updated by'}: {section.translation?.lastUpdatedBy?.username || 'seed'}</span>
                  </div>
                  <div style={styles.prose}>
                    <MdxClientRenderer source={section.translation?.mdxContent || ''} />
                  </div>
                </article>
              ))}
            </div>
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
  sidebarTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '16px' },
  sidebarTitle: { margin: 0, color: '#e6edf7', fontSize: '22px' },
  sidebarMeta: { margin: '6px 0 0', color: '#8fa4c3', fontSize: '13px' },
  search: { width: '100%', background: '#09111d', border: '1px solid #25344d', color: '#dce6f5', borderRadius: '10px', padding: '10px 12px', marginBottom: '14px' },
  searchPanel: { display: 'flex', flexDirection: 'column', gap: '8px' },
  searchResult: { textAlign: 'left', background: '#101b2c', border: '1px solid #25344d', color: '#dce6f5', borderRadius: '10px', padding: '10px 12px', cursor: 'pointer' },
  searchResultPage: { display: 'block', fontSize: '11px', color: '#6ea8ff', marginBottom: '4px', fontWeight: 700 },
  pageList: { display: 'flex', flexDirection: 'column', gap: '8px' },
  pageButton: { width: '100%', textAlign: 'left', background: 'transparent', border: '1px solid transparent', color: '#c4d2e7', borderRadius: '10px', padding: '10px 12px', cursor: 'pointer', fontWeight: 700 },
  pageButtonActive: { background: 'rgba(47,127,245,0.12)', borderColor: '#2f7ff5', color: '#fff' },
  sectionList: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 0 4px 14px' },
  sectionButton: { textAlign: 'left', background: 'transparent', border: 'none', color: '#8fa4c3', padding: '4px 0', cursor: 'pointer', fontSize: '13px' },
  sectionButtonActive: { color: '#e6edf7', fontWeight: 700 },
  contentWrap: { padding: '28px', overflowY: 'auto' },
  breadcrumbs: { display: 'flex', gap: '8px', color: '#8fa4c3', fontSize: '13px', marginBottom: '14px' },
  docCard: { background: '#0f192a', border: '1px solid #1f2f46', borderRadius: '18px', padding: '24px' },
  docHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '18px' },
  docTitle: { margin: 0, color: '#fff', fontSize: '28px' },
  docSubtitle: { margin: '8px 0 0', color: '#8fa4c3', fontSize: '14px' },
  backTop: { color: '#60a5fa', textDecoration: 'none', fontSize: '13px' },
  sectionCard: { padding: '18px 0 24px', borderTop: '1px solid #1d2b40' },
  sectionTop: { display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start' },
  sectionTitle: { margin: 0, color: '#f8fbff', fontSize: '22px' },
  sectionSummary: { margin: '8px 0 0', color: '#9ba9c3', fontSize: '14px' },
  metaRow: { display: 'flex', gap: '16px', flexWrap: 'wrap', color: '#6f87a6', fontSize: '12px', marginTop: '12px' },
  anchorBtn: { background: '#101d31', border: '1px solid #27415f', color: '#9ec3ff', borderRadius: '8px', cursor: 'pointer', fontWeight: 800, width: '32px', height: '32px' },
  prose: { color: '#dce6f5', lineHeight: 1.75, fontSize: '15px', marginTop: '18px' },
  loading: { color: '#9ba9c3', padding: '28px' },
  error: { color: '#fda4af', background: 'rgba(127,29,29,0.25)', padding: '16px', borderRadius: '12px' },
  empty: { color: '#8fa4c3', padding: '12px 0' },
};
