import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, LockKeyhole, Moon, Sun, UserRound } from 'lucide-react'
import { useAuthStore } from '@/store/auth'
import { useThemeStore } from '@/store/theme'
import { authApi } from '@/lib/api'
import { GitHubMark } from '@/components/icons/GitHubMark'
import { Logo } from '@/components/icons/Logo'
import { APP_VERSION } from '@/lib/version'
import './login.css'

const PARTICLE_COUNT = 28

export default function Login() {
  const navigate = useNavigate()
  const setSession = useAuthStore((s) => s.setSession)
  const { theme, toggleTheme } = useThemeStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [success, setSuccess] = useState(false)
  const submitRef = useRef<HTMLButtonElement>(null)
  const [portal, setPortal] = useState({ left: 0, top: 0, size: 0 })

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, () => {
        const angle = Math.random() * Math.PI * 2
        const dist = 90 + Math.random() * 150
        const dot = 4 + Math.random() * 6
        return {
          tx: Math.cos(angle) * dist,
          ty: Math.sin(angle) * dist,
          size: dot,
          delay: 1.35 + Math.random() * 0.2,
        }
      }),
    [],
  )

  const startSuccess = () => {
    const rect = submitRef.current?.getBoundingClientRect()
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
    const radius = Math.hypot(Math.max(cx, window.innerWidth - cx), Math.max(cy, window.innerHeight - cy)) + 24
    setPortal({ left: cx - radius, top: cy - radius, size: radius * 2 })
    setSuccess(true)
    document.body.style.overflow = 'hidden'
    window.setTimeout(() => {
      document.body.style.overflow = ''
      navigate('/', { replace: true })
    }, 3000)
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || password.length < 1) {
      setError('Enter your username and password to continue.')
      return
    }
    setLoading(true)
    try {
      const res = await authApi.login(username.trim(), password)
      const data = res.data.data
      if (res.data.code === 0 && data?.token) {
        setSession(data.token, data.username, data.role)
        startSuccess()
      } else {
        setError(res.data.message || 'Sign-in failed')
      }
    } catch (err) {
      // The axios interceptor already raises a toast; the login page also shows the
      // backend reason inline (wrong credentials / account disabled / network error).
      setError(err instanceof Error && err.message ? err.message : 'Network error, please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="lp-root">
      <section className="lp-art" aria-hidden="false">
        <div className="lp-par">
          <div className="lp-orb lp-o1" />
          <div className="lp-orb lp-o2" />
          <div className="lp-ring lp-g1" />
          <div className="lp-ring lp-g2" />
        </div>
        <div className="lp-hero">
          <div className="lp-t">
            <span className="lp-brand">
              <Logo size={34} />
              <span>Xray Pilot</span>
            </span>
            <span className="lp-pill">
              <i /> Secure connection
            </span>
            <h2>Welcome back</h2>
            <p>Sign in to your account to keep managing every proxy node in one place.</p>
          </div>
        </div>
      </section>

      <button type="button" className="lp-theme" onClick={toggleTheme} title="Switch theme">
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        {theme === 'dark' ? 'Light mode' : 'Night mode'}
      </button>

      <main className="lp-formcol">
        <div className="lp-card lp-enter">
          <h1>Sign in to your account</h1>
          <p className="lp-sub">Use your control-panel credentials to continue.</p>

          <form onSubmit={handleLogin} noValidate>
            <label className="lp-in lp-enter" style={{ ['--i' as string]: 3 }}>
              <UserRound className="h-[18px] w-[18px]" />
              <input
                type="text"
                dir="auto"
                autoComplete="username"
                placeholder="Username"
                aria-label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>

            <label className="lp-in lp-enter" style={{ ['--i' as string]: 4 }}>
              <LockKeyhole className="h-[18px] w-[18px]" />
              <input
                type={revealed ? 'text' : 'password'}
                dir="auto"
                autoComplete="current-password"
                placeholder="Password"
                aria-label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className={`lp-eye${revealed ? ' lp-on' : ''}`}
                onClick={() => setRevealed((v) => !v)}
                aria-label={revealed ? 'Hide password' : 'Show password'}
              >
                <Eye className="lp-vis h-[18px] w-[18px]" />
                <EyeOff className="lp-off h-[18px] w-[18px]" />
              </button>
            </label>

            <button
              ref={submitRef}
              className={`lp-go lp-enter${loading ? ' lp-load' : ''}`}
              style={{ ['--i' as string]: 5 }}
              type="submit"
              disabled={loading || success}
            >
              <span className="lp-lbl">Sign in</span>
              <ArrowRight className="lp-ar h-[18px] w-[18px]" />
              <span className="lp-sp" />
            </button>

            <div className="lp-msg" role="alert">
              {error}
            </div>
          </form>

          <div className="lp-or lp-enter" style={{ ['--i' as string]: 6 }}>
            or continue with
          </div>

          <div className="lp-enter" style={{ ['--i' as string]: 7 }}>
            <a className="lp-soc" href="https://github.com/imrui/xray-pilot" target="_blank" rel="noreferrer">
              <GitHubMark />
              GitHub
            </a>
          </div>

          <div className="lp-foot lp-enter" style={{ ['--i' as string]: 8 }}>
            <span>
              © 2026 Xray Pilot ·{' '}
              <a
                className="lp-lnk"
                href="https://github.com/imrui/xray-pilot/releases"
                target="_blank"
                rel="noreferrer"
                title="View release notes"
              >
                {APP_VERSION}
              </a>
            </span>
            <a className="lp-lnk" href="https://github.com/imrui/xray-pilot" target="_blank" rel="noreferrer">
              Source
            </a>
          </div>
        </div>
      </main>

      <div
        className={`lp-portal${success ? ' lp-on' : ''}`}
        style={{ left: portal.left, top: portal.top, width: portal.size, height: portal.size }}
      />
      <div className={`lp-win${success ? ' lp-on' : ''}`} aria-live="polite">
        <div className="lp-ring lp-w1" />
        <div className="lp-ring lp-w2" />
        <div className="lp-stage">
          <div className="lp-chk">
            <i className="lp-rp" />
            <i className="lp-rp" />
            <i className="lp-rp" />
            {particles.map((p, i) => (
              <i
                key={i}
                className="lp-pt"
                style={{
                  ['--tx' as string]: `${p.tx.toFixed(1)}px`,
                  ['--ty' as string]: `${p.ty.toFixed(1)}px`,
                  width: p.size,
                  height: p.size,
                  animationDelay: `${p.delay.toFixed(2)}s`,
                }}
              />
            ))}
            <div className="lp-core">
              <svg viewBox="0 0 64 64">
                <path d="M16 33l11 11 21-23" />
              </svg>
            </div>
          </div>
          <h2>Signed in</h2>
          <p className="lp-sub2">Taking you to your dashboard…</p>
        </div>
      </div>
    </div>
  )
}
