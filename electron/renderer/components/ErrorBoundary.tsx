import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { appLog } from '../utils/appLog'

interface State {
  error: Error | null
}

/**
 * Catches a render crash anywhere below it. Without it React unmounts the
 * whole tree and the window goes blank white with nothing to go on; with it,
 * the error is on screen, logged to the terminal and agent.log, and Reload
 * gets the app back.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    appLog('error', 'render', `${error.name}: ${error.message}\n${error.stack ?? ''}\nComponent stack:${info.componentStack ?? ''}`)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 6 }}>
        <Stack spacing={2.5} sx={{ maxWidth: 720, width: '100%' }}>
          <Typography variant='h5' sx={{ fontWeight: 700 }}>
            Something went wrong in this screen
          </Typography>
          <Alert severity='error' sx={{ wordBreak: 'break-word' }}>
            {error.name}: {error.message}
          </Alert>
          <Box
            component='pre'
            sx={{ m: 0, p: 2, maxHeight: 260, overflow: 'auto', fontSize: 11, bgcolor: 'action.hover', borderRadius: 1.5 }}
          >
            {error.stack}
          </Box>
          <Typography variant='body2' color='text.secondary'>
            The details are also in agent.log (Settings → About → Log file). Reload to carry on.
          </Typography>
          <Box>
            <Button variant='contained' onClick={() => window.location.reload()}>
              Reload
            </Button>
          </Box>
        </Stack>
      </Box>
    )
  }
}
