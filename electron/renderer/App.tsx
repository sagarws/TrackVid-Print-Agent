import { useCallback, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { Box } from '@mui/material'
import type { AgentState } from '@shared/types/agent'
import Sidebar, { type Page } from './layout/Sidebar'
import TopBar from './layout/TopBar'
import HomePage from './pages/HomePage'
import SettingsPage from './pages/SettingsPage'
import ScanPackSection from './scanpack/ScanPackSection'
import BackgroundProcessPage from './pages/BackgroundProcessPage'

const App = ({ state }: { state: AgentState }) => {
  const [page, setPage] = useState<Page>('home')
  const [query, setQuery] = useState('')
  // Where Scan and Pack was left, so the sidebar returns to the same screen.
  const [scanPackPath, setScanPackPath] = useState('/scan-and-pack')
  const rememberScanPackPath = useCallback((path: string) => setScanPackPath(path), [])

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
            <ScanPackSection initialPath={scanPackPath} onPathChange={rememberScanPackPath} />
          )}
          {page === 'background' && <BackgroundProcessPage />}
          {page === 'settings' && <SettingsPage state={state} />}
        </Box>
      </Box>
      {/* The Scan & Pack screens report through react-hot-toast, as in the web app. */}
      <Toaster position='top-right' />
    </Box>
  )
}

export default App
