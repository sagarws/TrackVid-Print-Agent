import { useCallback, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { Box } from '@mui/material'
import { MemoryRouter } from 'react-router-dom'
import type { AgentState } from '@shared/types/agent'
import Sidebar, { type Page } from './layout/Sidebar'
import TopBar from './layout/TopBar'
import HomePage from './pages/HomePage'
import SettingsPage from './pages/SettingsPage'
import ScanPackSection from './scanpack/ScanPackSection'
import BackgroundProcessPage from './pages/BackgroundProcessPage'
import SkuMappingPage from './scanpack/pages/SkuMappingPage'
import LabelSortingPage from './scanpack/pages/LabelSortingPage'
import PacklogJobsDock from './scanpack/background/PacklogJobsDock'

const App = ({ state }: { state: AgentState }) => {
  const [page, setPage] = useState<Page>('home')
  const [query, setQuery] = useState('')
  // Where Scan and Pack was left, so the sidebar returns to the same screen.
  const [scanPackPath, setScanPackPath] = useState('/scan-and-pack')
  const rememberScanPackPath = useCallback((path: string) => setScanPackPath(path), [])
  // Bumped to remount Scan and Pack on a jump from elsewhere (its router only reads the path on mount).
  const [scanPackVisit, setScanPackVisit] = useState(0)
  const openPacklog = useCallback((packlogObjectId: string) => {
    setScanPackPath(`/scan-and-pack/${encodeURIComponent(packlogObjectId)}`)
    setScanPackVisit(n => n + 1)
    setPage('scanpack')
  }, [])

  const search = (value: string) => {
    setQuery(value)
    // Search filters the Home screen; typing from Settings takes you there.
    if (value && page !== 'home') setPage('home')
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Sidebar page={page} onNavigate={setPage} state={state} />
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar query={query} onQueryChange={search} jobs={state.jobs} onOpenSettings={() => setPage('settings')} />
        <Box component='main' sx={{ flex: 1, overflow: 'auto', px: 5, py: 5 }}>
          {page === 'home' && <HomePage state={state} query={query} />}
          {page === 'scanpack' && (
            <ScanPackSection key={scanPackVisit} initialPath={scanPackPath} onPathChange={rememberScanPackPath} />
          )}
          {/* Own routers: the Scan & Pack tables key their saved column widths on the path. */}
          {page === 'skuMapping' && (
            <MemoryRouter initialEntries={['/sku-mapping']}>
              <SkuMappingPage />
            </MemoryRouter>
          )}
          {page === 'labelSorting' && (
            <MemoryRouter initialEntries={['/label-sorting']}>
              <LabelSortingPage onOpenPacklog={openPacklog} />
            </MemoryRouter>
          )}
          {page === 'background' && <BackgroundProcessPage />}
          {page === 'settings' && <SettingsPage state={state} />}
        </Box>
      </Box>
      {/* The Scan & Pack screens report through react-hot-toast, as in the web app. */}
      <Toaster position='top-right' />
      {/* Packlogs created and labels downloaded in the background, on every page. */}
      <PacklogJobsDock onOpenPacklog={openPacklog} />
    </Box>
  )
}

export default App
