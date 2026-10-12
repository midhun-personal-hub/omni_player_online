import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { performStartupCacheMaintenance } from './utils/cacheManager';

// Run Phase 3B startup cache sweep
performStartupCacheMaintenance().catch(console.warn);

createRoot(document.getElementById('root')!).render(<App />);
