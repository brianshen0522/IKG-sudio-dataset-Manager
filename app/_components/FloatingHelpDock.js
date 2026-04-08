"use client";

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buildHelpHref } from '@/lib/help-docs';
import { useCurrentUser } from './useCurrentUser';
import LanguageSwitcher from './LanguageSwitcher';

export default function FloatingHelpDock() {
  const pathname = usePathname();
  const { user } = useCurrentUser();

  const helpHref = useMemo(() => buildHelpHref({ pathname, role: user?.role }), [pathname, user?.role]);

  return (
    <div style={styles.wrap}>
      <Link href={helpHref} style={styles.link}>Manual</Link>
      {user?.role === 'admin' ? <Link href="/admin/docs" style={styles.link}>Docs Editor</Link> : null}
      <LanguageSwitcher />
    </div>
  );
}

const styles = {
  wrap: {
    position: 'fixed',
    top: '18px',
    right: '18px',
    zIndex: 1200,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    background: 'rgba(13,26,46,0.9)',
    border: '1px solid #25344d',
    padding: '10px 12px',
    borderRadius: '12px',
    backdropFilter: 'blur(8px)',
  },
  link: {
    color: '#dce6f5',
    textDecoration: 'none',
    border: '1px solid #314362',
    borderRadius: '8px',
    padding: '6px 10px',
    fontSize: '12px',
    fontWeight: 700,
  },
};
