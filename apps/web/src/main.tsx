import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { NdekoProvider } from './context/NdekoContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <NdekoProvider>
      <App />
    </NdekoProvider>
  </React.StrictMode>,
);
