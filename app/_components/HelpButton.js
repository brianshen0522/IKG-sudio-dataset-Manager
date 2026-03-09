"use client";

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import EditorHelpModal from './EditorHelpModal';
import ManagerHelpModal from './ManagerHelpModal';
import { useTranslation } from './LanguageProvider';
import LanguageSwitcher from './LanguageSwitcher';
import styles from './HelpButton.module.css';

export default function HelpButton() {
  const pathname = usePathname();
  const [showHelp, setShowHelp] = useState(false);
  const { t, isReady } = useTranslation();

  const isLabelEditor = pathname?.startsWith('/label-editor');

  if (pathname === '/login') return null;

  return (
    <>
      <div className={styles.floatingControls}>
        <button
          type="button"
          className={styles.tourHelpButton}
          onClick={() => setShowHelp(true)}
        >
          {isReady ? t('common.help') || 'Help' : 'Help'}
        </button>
        <LanguageSwitcher />
      </div>
      {isLabelEditor ? (
        <EditorHelpModal
          isOpen={showHelp}
          onClose={() => setShowHelp(false)}
        />
      ) : (
        <ManagerHelpModal
          isOpen={showHelp}
          onClose={() => setShowHelp(false)}
        />
      )}
    </>
  );
}
