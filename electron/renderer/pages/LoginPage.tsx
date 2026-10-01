import { useState, type FormEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import { useAuth } from '../auth/AuthProvider'
import { API_BASE_URL, ApiError } from '../api/axios'
import { SIDEBAR } from '../theme/brand'
import logo from '../assets/logo.svg'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Login with the TrackVid web admin's credentials — same endpoint, same
 * fields, same wording as TrackVid-FE's Login page.
 */
const LoginPage = () => {
  const { login, notice } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The server's own reason behind a 5xx ("Internal server error!"), shown under it.
  const [detail, setDetail] = useState<string | null>(null)

  const emailError = touched && !EMAIL.test(email.trim()) ? 'Enter a valid email address.' : null
  const passwordError = touched && !password ? 'Enter your password.' : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!EMAIL.test(email.trim()) || !password) return
    setSubmitting(true)
    setError(null)
    setDetail(null)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.')
      if (err instanceof ApiError && (err.status === null || err.status >= 500) && err.detail) {
        setDetail(`${err.status ? `HTTP ${err.status}: ` : ''}${err.detail}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex' }}>
      <Box
        sx={theme => ({
          width: 380,
          flexShrink: 0,
          bgcolor: SIDEBAR.bg,
          color: SIDEBAR.text,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 6,
          ...theme.applyStyles('dark', { bgcolor: SIDEBAR.bgDark })
        })}
      >
        <Stack direction='row' spacing={1.5} alignItems='center'>
          <Box component='img' src={logo} alt='' sx={{ width: 40, height: 33 }} />
          <Typography sx={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>TrackVid</Typography>
        </Stack>
        <Box>
          <Typography sx={{ color: '#fff', fontSize: 24, fontWeight: 700, lineHeight: 1.3 }}>
            Print Agent &amp; Scan and Pack
          </Typography>
          <Typography sx={{ color: SIDEBAR.textMuted, fontSize: 14, mt: 1.5 }}>
            Labels and invoices straight to this computer's printers, and Scan &amp; Pack on the packing desk — with
            your TrackVid account.
          </Typography>
        </Box>
        <Typography sx={{ color: SIDEBAR.textMuted, fontSize: 12 }}>{API_BASE_URL}</Typography>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4, bgcolor: 'background.default' }}>
        <Paper variant='outlined' sx={{ width: '100%', maxWidth: 420, p: 5, borderRadius: 3 }}>
          <Stack spacing={3} component='form' onSubmit={event => void submit(event)} noValidate>
            <Box>
              <Typography sx={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                Welcome back
              </Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.secondary', mt: 0.75 }}>
                Sign in to continue to your TrackVid workspace.
              </Typography>
            </Box>

            {notice && !error && <Alert severity='warning'>{notice}</Alert>}
            {error && (
              <Alert severity='error'>
                {error}
                {detail && (
                  <Typography component='div' sx={{ fontSize: 12, mt: 0.5, opacity: 0.85, wordBreak: 'break-word' }}>
                    Details: {detail}
                  </Typography>
                )}
              </Alert>
            )}

            <TextField
              label='Email'
              placeholder='you@company.com'
              type='email'
              autoComplete='username'
              autoFocus
              fullWidth
              value={email}
              onChange={event => setEmail(event.target.value)}
              error={Boolean(emailError)}
              helperText={emailError ?? ' '}
              disabled={submitting}
            />
            <TextField
              label='Password'
              placeholder='Enter your password'
              type={showPassword ? 'text' : 'password'}
              autoComplete='current-password'
              fullWidth
              value={password}
              onChange={event => setPassword(event.target.value)}
              error={Boolean(passwordError)}
              helperText={passwordError ?? ' '}
              disabled={submitting}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position='end'>
                      <IconButton
                        aria-label='toggle password visibility'
                        onClick={() => setShowPassword(value => !value)}
                        edge='end'
                        size='small'
                      >
                        <i className={showPassword ? 'tabler-eye-off' : 'tabler-eye'} style={{ fontSize: 18 }} />
                      </IconButton>
                    </InputAdornment>
                  )
                }
              }}
            />

            <Button type='submit' variant='contained' size='large' disabled={submitting} fullWidth>
              {submitting ? <CircularProgress size={20} color='inherit' /> : 'Sign in'}
            </Button>

            <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center' }}>
              Use your TrackVid web admin email and password. Forgot it, or no account yet? Reset or sign up in the
              TrackVid web admin.
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'text.disabled', textAlign: 'center' }}>
              By signing in you agree to TrackVid's Terms of Service and Privacy Policy.
            </Typography>
          </Stack>
        </Paper>
      </Box>
    </Box>
  )
}

export default LoginPage
