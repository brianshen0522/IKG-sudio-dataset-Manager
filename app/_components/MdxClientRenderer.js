"use client";

import { useEffect, useState } from 'react';
import { mdxComponents } from '@/lib/mdx-components';
import { compileMdxToComponent } from '@/lib/mdx';

export default function MdxClientRenderer({ source }) {
  const [state, setState] = useState({ loading: true, error: '', Component: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: '', Component: null });

    compileMdxToComponent(source || '')
      .then((Component) => {
        if (!cancelled) setState({ loading: false, error: '', Component });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            loading: false,
            error: error?.message || 'Failed to render document.',
            Component: null,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (state.loading) {
    return <div style={{ color: '#9ba9c3', fontSize: '14px' }}>Rendering preview…</div>;
  }

  if (state.error) {
    return (
      <div style={{ color: '#fca5a5', fontSize: '13px', whiteSpace: 'pre-wrap' }}>
        {state.error}
      </div>
    );
  }

  const Component = state.Component;
  return Component ? <Component components={mdxComponents} /> : null;
}
