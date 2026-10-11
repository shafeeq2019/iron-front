import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';

// Block browser gestures that would interfere with gameplay (pinch-zoom of the page, iOS double-tap zoom).
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

createRoot(document.getElementById('root')!).render(<App />);
