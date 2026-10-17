import React from 'react';
import ReactDOM from 'react-dom/client';
import {RouterProvider} from 'react-router-dom';
import {QueryClientProvider} from '@tanstack/react-query';
import {queryClient} from '@/lib/query-client';
import {TooltipProvider} from '@/components/ui/tooltip';
import {Toaster} from '@/components/ui/sonner';
import {ThemeProvider} from '@/hooks/use-theme';
import {FontSizeProvider} from '@/hooks/use-font-size';
import {router} from './router';
import './i18n';
import './index.css';
import '@eternalheart/react-file-preview/style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <FontSizeProvider>
            <RouterProvider router={router} />
            <Toaster />
          </FontSizeProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
