import type * as React from 'react';
import { useEffect, useState } from 'react';
import { Home } from './Home.js';
import { EditorPage } from './EditorPage.js';

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function App(): React.JSX.Element {
  const hash = useHash();
  const match = /^#\/p\/(.+)$/.exec(hash);
  if (match) return <EditorPage slug={decodeURIComponent(match[1]!)} />;
  return <Home />;
}
