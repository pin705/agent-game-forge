import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import { I18nProvider } from '@/lib/i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <App />
        <Toaster richColors position="bottom-right" theme="dark" />
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>,
);
