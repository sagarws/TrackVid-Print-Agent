import { useState } from 'react'
import { Box } from '@mui/material'
import type { AgentState } from '@shared/types/agent'
import Sidebar, { type Page } from './layout/Sidebar'
import TopBar from './layout/TopBar'
import HomePage from './pages/HomePage'
import SettingsPage from './pages/SettingsPage'

const App = ({ state }: { state: AgentState }) => {
  const [page, setPage] = useState<Page>('home')
  const [query, setQuery] = useState('')

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
          {page === 'home' ? <HomePage state={state} query={query} /> : <SettingsPage state={state} />}
        </Box>
      </Box>
    </Box>
  )
}

export default App
