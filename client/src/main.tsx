import '@shopify/polaris/build/esm/styles.css';
import './styles.css';
import { AppProvider } from '@shopify/polaris';
import en from '@shopify/polaris/locales/en.json';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider i18n={en}>
      <App />
    </AppProvider>
  </StrictMode>,
);
