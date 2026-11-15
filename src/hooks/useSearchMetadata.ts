import { useEffect } from 'react';

export function useSearchMetadata(pathname: string) {
  useEffect(() => {
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (robots) {
      robots.content =
        pathname === '/' || pathname === '/login' ? 'index,follow' : 'noindex,follow';
    }
    document.title = '머문음';
  }, [pathname]);
}
