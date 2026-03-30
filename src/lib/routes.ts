type WithAppBasePathMode = 'router' | 'external';

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function getNormalizedBasePath(): string {
  const base = (process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '').trim();
  if (!base || base === '/') {
    return '';
  }
  return base.startsWith('/') ? base.replace(/\/+$/, '') : `/${base.replace(/\/+$/, '')}`;
}

function splitPath(path: string): { pathname: string; search: string; hash: string } {
  const url = new URL(path, 'http://localhost');
  return {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
}

function combinePath(parts: { pathname: string; search: string; hash: string }): string {
  const { pathname, search, hash } = parts;
  return `${pathname}${search}${hash}`;
}

export function withAppBasePath(path: string, mode: WithAppBasePathMode = 'router'): string {
  const { pathname, search, hash } = splitPath(normalizePath(path));
  const basePath = getNormalizedBasePath();

  if (!basePath) {
    return combinePath({ pathname, search, hash });
  }

  if (mode === 'external') {
    if (pathname === '/' || pathname === basePath) {
      return combinePath({ pathname: basePath || '/', search, hash });
    }
    if (pathname.startsWith(`${basePath}/`)) {
      return combinePath({ pathname, search, hash });
    }
    return combinePath({ pathname: `${basePath}${pathname}`, search, hash });
  }

  if (pathname === basePath) {
    return combinePath({ pathname: '/', search, hash });
  }

  if (pathname.startsWith(`${basePath}/`)) {
    const trimmed = pathname.slice(basePath.length) || '/';
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return combinePath({ pathname: normalized, search, hash });
  }

  return combinePath({ pathname, search, hash });
}
