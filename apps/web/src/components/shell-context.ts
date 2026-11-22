import { createContext, useContext } from 'react';

/**
 * True for pages drawn inside the signed-in shell. A few pages (the ones email links open, and the privacy
 * and terms pages) are reachable both signed in and signed out. Signed out they bring their own frame, glow
 * and page landmark; inside the shell they must not add a second of each.
 */
export const InShellContext = createContext(false);

export function useInShell(): boolean {
  return useContext(InShellContext);
}
