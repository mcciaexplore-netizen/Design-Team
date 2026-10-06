import { createContext, useContext } from 'react';
import type { RequestPrefill } from '../requestForm';

interface NewRequestContextValue {
  /** Open the New Request dialog, optionally with answers already filled in ("Request again"). */
  openNewRequest: (prefill?: RequestPrefill) => void;
}

export const NewRequestContext = createContext<NewRequestContextValue>({ openNewRequest: () => undefined });

export const useNewRequest = () => useContext(NewRequestContext);
