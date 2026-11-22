import { MutableRefObject, useEffect, useLayoutEffect, useRef } from 'react';

export const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Keeps a stable mutable ref synchronized with the latest rendered value via an
 * isomorphic layout effect, eliminating render-time ref mutations (`react/refs`).
 */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef<T>(value);
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
