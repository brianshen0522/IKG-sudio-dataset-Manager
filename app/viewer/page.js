"use client";

import { useEffect, useRef } from 'react';
import { useTranslation } from '../_components/LanguageProvider';

export default function ViewerPage() {
  const apiRef = useRef(null);
  const { isReady, lang } = useTranslation();

  useEffect(() => {
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    if (!htmlEl || !bodyEl) return undefined;

    const prevHtmlMargin = htmlEl.style.margin;
    const prevHtmlPadding = htmlEl.style.padding;
    const prevHtmlHeight = htmlEl.style.height;

    const prevBodyMargin = bodyEl.style.margin;
    const prevBodyPadding = bodyEl.style.padding;
    const prevBodyBackground = bodyEl.style.background;
    const prevBodyMinHeight = bodyEl.style.minHeight;
    const prevBodyOverflow = bodyEl.style.overflow;

    htmlEl.style.margin = '0';
    htmlEl.style.padding = '0';
    htmlEl.style.height = '100%';

    bodyEl.style.margin = '0';
    bodyEl.style.padding = '0';
    bodyEl.style.background = '#1a1a2e';
    bodyEl.style.minHeight = '100vh';
    bodyEl.style.overflow = 'hidden';

    return () => {
      htmlEl.style.margin = prevHtmlMargin;
      htmlEl.style.padding = prevHtmlPadding;
      htmlEl.style.height = prevHtmlHeight;

      bodyEl.style.margin = prevBodyMargin;
      bodyEl.style.padding = prevBodyPadding;
      bodyEl.style.background = prevBodyBackground;
      bodyEl.style.minHeight = prevBodyMinHeight;
      bodyEl.style.overflow = prevBodyOverflow;
    };
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    let active = true;
    import('@/lib/viewer-ui').then((mod) => {
      if (!active) return;
      apiRef.current = mod;
      if (mod.initViewer) {
        mod.initViewer();
      }
    });
    return () => {
      active = false;
    };
  }, [isReady]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    const api = apiRef.current;
    if (api && typeof api.refreshViewerLocale === 'function') {
      api.refreshViewerLocale();
    }
  }, [isReady, lang]);

  if (!isReady) {
    return <div style={{ padding: '20px', color: '#aaa' }}>Loading...</div>;
  }

  return (
    <div id="viewerRoot" style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }} />
  );
}
