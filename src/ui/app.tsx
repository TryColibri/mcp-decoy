import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
} from 'react-router';
import { SWRConfig } from 'swr';

import { NewServerPage } from './routes/new-server/new-server-page';
import { NotFoundPage } from './routes/not-found/not-found-page';
import { RootLayout } from './routes/root-layout';
import { LogsPage } from './routes/server/logs/logs-page';
import { ServerLayout } from './routes/server/server-layout';
import { ToolsPage } from './routes/server/tools/tools-page';
import { ServersPage } from './routes/servers/servers-page';

// A data router (still declarative `<Route>` elements, no loaders) because
// `useBlocker` only works inside one.
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<RootLayout />}>
      <Route index element={<ServersPage />} />
      <Route path="servers/new" element={<NewServerPage />} />
      <Route path="servers/:server" element={<ServerLayout />}>
        <Route index element={<Navigate to="logs" replace />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="tools/:tool?" element={<ToolsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Route>,
  ),
);

/** The MCP Decoy SPA: client-side routes over the REST API. */
export function App() {
  return (
    <SWRConfig value={{ revalidateOnFocus: true }}>
      <RouterProvider router={router} />
    </SWRConfig>
  );
}
