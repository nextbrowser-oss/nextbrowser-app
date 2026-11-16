import React from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '../shared/ui';
import { StartPage } from './StartPage';
import '../palette.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/hanken-grotesk/600.css';
import './startPage.css';

document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
createRoot(document.getElementById('root')!).render(<React.StrictMode><TooltipProvider><StartPage /></TooltipProvider></React.StrictMode>);
