export const DOC_LANGS = ['en', 'zh-TW'];
export const DOC_DEFAULT_LANG = 'en';
export const DOC_ROLES = ['admin', 'data-manager', 'user'];
export const DOC_SHARED_ALL = 'shared-all';
export const DOC_SHARED_OPERATORS = 'shared-operators';
export const DOC_EDITOR_PAGE = 'docs-editor';

export const DOC_PAGE_DEFS = {
  'system-overview': {
    order: 0,
    labels: {
      en: 'System Overview',
      'zh-TW': 'System Overview',
    },
  },
  dataset: {
    order: 10,
    labels: {
      en: 'Dataset',
      'zh-TW': 'Dataset',
    },
  },
  'dataset-detail': {
    order: 20,
    labels: {
      en: 'Dataset Detail',
      'zh-TW': 'Dataset Detail',
    },
  },
  'my-jobs': {
    order: 30,
    labels: {
      en: 'My Jobs',
      'zh-TW': 'My Jobs',
    },
  },
  archive: {
    order: 40,
    labels: {
      en: 'Archive',
      'zh-TW': 'Archive',
    },
  },
  'background-jobs': {
    order: 50,
    labels: {
      en: 'Background Jobs',
      'zh-TW': 'Background Jobs',
    },
  },
  users: {
    order: 60,
    labels: {
      en: 'Users',
      'zh-TW': 'Users',
    },
  },
  settings: {
    order: 70,
    labels: {
      en: 'Settings',
      'zh-TW': 'Settings',
    },
  },
  viewer: {
    order: 80,
    labels: {
      en: 'Viewer',
      'zh-TW': 'Viewer',
    },
  },
  editor: {
    order: 90,
    labels: {
      en: 'Editor',
      'zh-TW': 'Editor',
    },
  },
  shortcuts: {
    order: 100,
    labels: {
      en: 'Shortcuts',
      'zh-TW': 'Shortcuts',
    },
  },
};

export function normalizeDocLang(lang) {
  return DOC_LANGS.includes(lang) ? lang : DOC_DEFAULT_LANG;
}

export function normalizeDocRole(role) {
  return DOC_ROLES.includes(role) ? role : 'user';
}

export function getPageLabel(pageKey, lang = DOC_DEFAULT_LANG) {
  const page = DOC_PAGE_DEFS[pageKey];
  if (!page) return pageKey;
  const resolvedLang = normalizeDocLang(lang);
  return page.labels[resolvedLang] || page.labels[DOC_DEFAULT_LANG] || pageKey;
}

export function getRoleLabel(role, lang = DOC_DEFAULT_LANG) {
  const resolvedLang = normalizeDocLang(lang);
  const labels = {
    en: {
      admin: 'Admin',
      'data-manager': 'Dataset Manager',
      user: 'User',
    },
    'zh-TW': {
      admin: 'Admin',
      'data-manager': 'Dataset Manager',
      user: 'User',
    },
  };
  return labels[resolvedLang]?.[role] || role;
}

export function getAllowedAudienceRoles(userRole) {
  const resolvedRole = normalizeDocRole(userRole);
  const roles = [resolvedRole, DOC_SHARED_ALL];
  if (resolvedRole === 'user' || resolvedRole === 'data-manager') {
    roles.push(DOC_SHARED_OPERATORS);
  }
  return roles;
}

export function isSectionVisibleToRole(sectionRole, userRole) {
  return getAllowedAudienceRoles(userRole).includes(sectionRole);
}

export function getPageOrder(pageKey) {
  return DOC_PAGE_DEFS[pageKey]?.order ?? 9999;
}

export function sortPages(pageKeys) {
  return [...pageKeys].sort((a, b) => getPageOrder(a) - getPageOrder(b));
}

export function getDocPageKeyFromPath(pathname, role = 'user') {
  if (!pathname) return 'system-overview';
  if (pathname === '/') return normalizeDocRole(role) === 'user' ? 'my-jobs' : 'dataset';
  if (pathname.startsWith('/datasets/')) return 'dataset-detail';
  if (pathname.startsWith('/archive')) return 'archive';
  if (pathname.startsWith('/admin/tasks')) return 'background-jobs';
  if (pathname.startsWith('/admin/users')) return 'users';
  if (pathname.startsWith('/admin/settings')) return 'settings';
  if (pathname.startsWith('/viewer')) return 'viewer';
  if (pathname.startsWith('/label-editor')) return 'editor';
  if (pathname.startsWith('/profile/shortcuts')) return 'shortcuts';
  if (pathname.startsWith('/help')) return 'system-overview';
  if (pathname.startsWith('/admin/docs')) return DOC_EDITOR_PAGE;
  return 'system-overview';
}

export function buildHelpHref({ pathname, role, section, pageKey }) {
  const params = new URLSearchParams();
  const rawPage = pageKey || getDocPageKeyFromPath(pathname, role);
  const resolvedPage = rawPage === DOC_EDITOR_PAGE ? 'system-overview' : rawPage;
  if (resolvedPage) params.set('page', resolvedPage);
  if (section) params.set('section', section);
  const query = params.toString();
  return query ? `/help?${query}` : '/help';
}

export function makeDocSectionKey(pageKey, slug, role = DOC_SHARED_ALL) {
  return `${pageKey}:${role}:${slug}`;
}
