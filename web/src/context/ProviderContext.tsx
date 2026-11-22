import React, { createContext, useContext } from 'react';
import { ProviderRegistry } from '../services/providers/ProviderRegistry';

export type Providers = typeof ProviderRegistry;

export const ProviderContext = createContext<Providers>(ProviderRegistry);

export interface ProviderContextProviderProps {
  value?: Providers;
  children: React.ReactNode;
}

export function ProviderContextProvider({
  value = ProviderRegistry,
  children,
}: ProviderContextProviderProps): React.ReactElement {
  return <ProviderContext.Provider value={value}>{children}</ProviderContext.Provider>;
}

export function useProviders(): Providers {
  return useContext(ProviderContext);
}

export function useAuthProvider(): Providers['auth'] {
  return useProviders().auth;
}

export function useCloudSaveProvider(): Providers['cloudSave'] {
  return useProviders().cloudSave;
}

export function useRealtimeRoomProvider(): Providers['realtimeRoom'] {
  return useProviders().realtimeRoom;
}

export function useCatalogProvider(): Providers['catalog'] {
  return useProviders().catalog;
}
