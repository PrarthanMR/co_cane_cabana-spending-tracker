import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  createInvitation,
  deactivateMember,
  getMembers,
  getAuthSession,
  getAuthStatus,
  joinBusiness,
  login,
  logout,
  registerOwner,
  selectBusiness,
  type AuthSession,
} from '../services/api'

type AuthMode = 'login' | 'register' | 'join'

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [registrationComplete, setRegistrationComplete] = useState(true)
  const [mode, setMode] = useState<AuthMode>('login')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [pin, setPin] = useState('')
  const [bootstrapToken, setBootstrapToken] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [invitationCode, setInvitationCode] = useState('')

  async function refreshSession() {
    try {
      setSession(await getAuthSession())
    } catch {
      setSession(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    getAuthStatus()
      .then(({ registrationComplete: complete }) => {
        setRegistrationComplete(complete)
        if (!complete) setMode('register')
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Unable to load'))
      .finally(() => void refreshSession())
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'register') {
        await registerOwner({
          bootstrapToken,
          businessName,
          username,
          displayName,
          pin,
        })
        setRegistrationComplete(true)
      } else if (mode === 'join') {
        await joinBusiness({ invitationCode, username, displayName, pin })
      } else {
        await login({ username, pin })
      }
      setPin('')
      setBootstrapToken('')
      await refreshSession()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to authenticate')
    } finally {
      setBusy(false)
    }
  }

  async function changeBusiness(businessId: number) {
    setError('')
    try {
      await selectBusiness(businessId)
      await refreshSession()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to select business')
    }
  }

  async function signOut() {
    await logout()
    setSession(null)
    setMode('login')
  }

  if (loading) {
    return <main className="mx-auto max-w-lg p-6 text-slate-600">Checking your session…</main>
  }

  if (session?.activeBusinessId !== null && session) {
    const activeMembership = session.memberships.find(
      (member) => member.businessId === session.activeBusinessId,
    )
    return (
      <>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 pt-3 text-sm text-slate-600 sm:px-6">
          <span>{session.user.displayName} · {activeMembership?.businessName}</span>
          <button type="button" onClick={() => void signOut()} className="font-medium text-slate-700 underline">
            Sign out
          </button>
        </div>
        {activeMembership?.role === 'owner' && <OwnerMembershipControls />}
        {children}
      </>
    )
  }

  if (session && session.memberships.length > 1) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold text-slate-900">Choose a business</h1>
        <p className="mt-2 text-sm text-slate-600">Signed in as {session.user.displayName}.</p>
        <div className="mt-5 grid gap-2">
          {session.memberships.map((member) => (
            <button
              key={member.businessId}
              type="button"
              onClick={() => void changeBusiness(member.businessId)}
              className="rounded-lg border border-slate-300 px-4 py-3 text-left hover:bg-slate-50"
            >
              {member.businessName} <span className="text-slate-500">({member.role})</span>
            </button>
          ))}
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <button type="button" onClick={() => void signOut()} className="mt-4 text-sm underline">Sign out</button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">Purchase Spending Tracker</h1>
      <p className="mt-2 text-sm text-slate-600">
        {mode === 'login' ? 'Sign in with your individual account.' : mode === 'join' ? 'Join a business using your invitation code.' : 'Create the first business owner account.'}
      </p>
      <form onSubmit={submit} className="mt-6 grid gap-4">
        {mode === 'register' && (
          <>
            <Field label="Bootstrap token" value={bootstrapToken} onChange={setBootstrapToken} type="password" autoComplete="off" />
            <Field label="Business name" value={businessName} onChange={setBusinessName} />
          </>
        )}
        {mode === 'join' && <Field label="Invitation code" value={invitationCode} onChange={setInvitationCode} autoComplete="off" />}
        <Field label="Username" value={username} onChange={setUsername} autoComplete="username" />
        {mode !== 'login' && <Field label="Display name" value={displayName} onChange={setDisplayName} autoComplete="name" />}
        <Field label="PIN (8–12 digits)" value={pin} onChange={setPin} type="password" autoComplete="current-password" />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="rounded-lg bg-emerald-700 px-4 py-3 font-medium text-white disabled:opacity-60">
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'join' ? 'Join business' : 'Create business'}
        </button>
      </form>
      <div className="mt-5 flex gap-4 text-sm">
        {registrationComplete && mode !== 'login' && <button type="button" onClick={() => setMode('login')} className="underline">Sign in</button>}
        {registrationComplete && mode !== 'join' && <button type="button" onClick={() => setMode('join')} className="underline">Join with invitation</button>}
        {!registrationComplete && mode !== 'register' && <button type="button" onClick={() => setMode('register')} className="underline">Initial setup</button>}
      </div>
    </main>
  )
}

function OwnerMembershipControls() {
  const [members, setMembers] = useState<Array<{
    userId: number
    username: string
    displayName: string
    role: 'owner' | 'member'
  }>>([])
  const [invitationCode, setInvitationCode] = useState('')
  const [invitationExpiresAt, setInvitationExpiresAt] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function refreshMembers() {
    try {
      setMembers((await getMembers()).members)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load members')
    }
  }

  useEffect(() => {
    let active = true
    getMembers()
      .then(({ members: currentMembers }) => {
        if (active) setMembers(currentMembers)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Unable to load members')
      })
    return () => {
      active = false
    }
  }, [])

  async function generateInvitation() {
    setLoading(true)
    setError('')
    try {
      const invitation = await createInvitation()
      setInvitationCode(invitation.code)
      setInvitationExpiresAt(invitation.expiresAt)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create invitation')
    } finally {
      setLoading(false)
    }
  }

  async function removeMember(userId: number, displayName: string) {
    if (!window.confirm(`Deactivate ${displayName}? Their sessions for this business will be revoked.`)) return
    setError('')
    try {
      await deactivateMember(userId)
      await refreshMembers()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to deactivate member')
    }
  }

  return (
    <details className="mx-auto mt-3 max-w-7xl px-4 sm:px-6">
      <summary className="cursor-pointer text-sm font-medium text-slate-700">Business membership</summary>
      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
        <button
          type="button"
          disabled={loading}
          onClick={() => void generateInvitation()}
          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? 'Creating…' : 'Generate one-time invitation'}
        </button>
        {invitationCode && (
          <div className="mt-3 rounded bg-slate-50 p-3" aria-live="polite">
            <p className="break-all font-mono text-sm">Share once: {invitationCode}</p>
            {invitationExpiresAt && (
              <p className="mt-1 text-xs text-slate-600">
                Expires {new Date(invitationExpiresAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
        {members.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>{member.displayName} <span className="text-slate-500">({member.role})</span></span>
                {member.role === 'member' && (
                  <button
                    type="button"
                    onClick={() => void removeMember(member.userId, member.displayName)}
                    className="text-red-700 underline"
                  >
                    Deactivate
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
    </details>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  autoComplete?: string
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required
        className="rounded-lg border border-slate-300 px-3 py-2"
      />
    </label>
  )
}
