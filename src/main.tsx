import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-nastaliq-urdu/400.css';
import '@fontsource/noto-nastaliq-urdu/700.css';
import './styles.css';
import App from './App';
import { registerSW } from './lib/pwa';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
registerSW();
