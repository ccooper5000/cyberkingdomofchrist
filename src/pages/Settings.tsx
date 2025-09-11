import React, { useEffect, useState } from 'react'
import { getMyProfile, saveMyProfile, isUsernameAvailable } from '@/lib/profile'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'


export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [initialUsername, setInitialUsername] = useState('') // for availability logic
  const [bio, setBio] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [myUserId, setMyUserId] = useState<string | null>(null) // Current user id (for membership lookup)

  // Instant-save toggle state
  const [isPublicSaving, setIsPublicSaving] = useState(false)
  const [isPublicError, setIsPublicError] = useState<string | null>(null)
  const [isPublicSavedAt, setIsPublicSavedAt] = useState<number | null>(null)

  // Username availability status
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'error'
  >('idle')

  const [fieldErrors, setFieldErrors] = useState<{
    first_name?: string
    last_name?: string
    username?: string
    bio?: string
  }>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  type JoinedGroup = {
  id: string
  name: string
  description: string | null
}

const [joinedGroups, setJoinedGroups] = useState<JoinedGroup[]>([])
const [groupsLoading, setGroupsLoading] = useState(false)
const [groupsError, setGroupsError] = useState<string | null>(null)


  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await getMyProfile()
      if (!active) return
      if (!error && data) {
        setFirstName((data as any).first_name ?? '')
        setLastName((data as any).last_name ?? '')
        setUsername(data.username ?? '')
        setInitialUsername(data.username ?? '')
        setBio((data as any).bio ?? '')
        setIsPublic((data as any).is_public ?? true)
        setMyUserId((data as any).id ?? null)

      }
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  // Load groups this user has joined
useEffect(() => {
  if (!myUserId) return
  let active = true
  ;(async () => {
    setGroupsLoading(true)
    setGroupsError(null)
    try {
      // 1) memberships → group ids
      const { data: mData, error: mErr } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', myUserId)

      if (mErr) throw mErr
      if (!active) return

      const ids = Array.from(new Set((mData ?? []).map((r: any) => r.group_id)))
      if (ids.length === 0) {
        setJoinedGroups([])
        return
      }

      // 2) groups by id
      const { data: gData, error: gErr } = await supabase
        .from('groups')
        .select('id, name, description')
        .in('id', ids)
        .order('name', { ascending: true })

      if (gErr) throw gErr
      if (!active) return

      setJoinedGroups((gData ?? []) as JoinedGroup[])
    } catch (e: any) {
      if (!active) return
      setGroupsError(e?.message || 'Could not load groups.')
    } finally {
      if (!active) return
      setGroupsLoading(false)
    }
  })()
  return () => {
    active = false
  }
}, [myUserId])


  // Debounced username availability check (treat current username as available)
  useEffect(() => {
    if (loading) return
    const raw = username.trim().toLowerCase()
    if (!raw) {
      setUsernameStatus('idle')
      return
    }
    // If unchanged from the originally loaded username, consider it available.
    if (raw === (initialUsername || '').toLowerCase()) {
      setUsernameStatus('available')
      return
    }

    let cancelled = false
    setUsernameStatus('checking')

    const handle = setTimeout(async () => {
      try {
        const available = await isUsernameAvailable(raw)
        if (cancelled) return
        setUsernameStatus(available ? 'available' : 'taken')
      } catch {
        if (cancelled) return
        setUsernameStatus('error')
      }
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, loading, initialUsername])

  const displayName =
    [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || username || ''

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setJustSaved(false)
    setGeneralError(null)
    setFieldErrors({})

    try {
      const payload = {
        first_name: firstName || null,
        last_name: lastName || null,
        username: (username || '').trim().toLowerCase() || null,
        bio: bio || null,
        is_public: isPublic,
      }

      const res = await saveMyProfile(payload)
      if (!res.ok) {
        if (res.fieldErrors) setFieldErrors(res.fieldErrors)
        if (res.error) setGeneralError(res.error)
        setSaving(false)
        return
      }

      // If username changed and saved, update our baseline
      setInitialUsername((res.profile?.username ?? username).toLowerCase())
      setJustSaved(true)
      setSaving(false)
    } catch (err: any) {
      setGeneralError(err?.message || 'Something went wrong.')
      setSaving(false)
    }
  }

  async function onTogglePublic(next: boolean) {
    if (isPublicSaving) return
    // optimistic UI
    setIsPublic(next)
    setIsPublicSaving(true)
    setIsPublicError(null)
    setIsPublicSavedAt(null)

    try {
      const res = await saveMyProfile({ is_public: next })
      if (!res.ok) {
        // rollback on failure
        setIsPublic(!next)
        setIsPublicError(res.error || 'Could not save. Please try again.')
      } else {
        setIsPublicSavedAt(Date.now())
      }
    } catch (err: any) {
      setIsPublic(!next)
      setIsPublicError(err?.message || 'Network error')
    } finally {
      setIsPublicSaving(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-america-text mb-2">Settings</h1>
        <p className="text-america-gray-dark">Manage your account and preferences</p>
      </div>

      <form onSubmit={onSave} className="space-y-8">
        {/* Profile Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>Update your public profile details</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Names */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first-name">First name</Label>
                <Input
                  id="first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  maxLength={50}
                  required
                />
                {fieldErrors.first_name && (
                  <p className="text-sm text-red-600">{fieldErrors.first_name}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="last-name">Last name</Label>
                <Input
                  id="last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  maxLength={50}
                  required
                />
                {fieldErrors.last_name && (
                  <p className="text-sm text-red-600">{fieldErrors.last_name}</p>
                )}
              </div>
            </div>

            {/* Username */}
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={() => setUsername((u) => u.trim().toLowerCase())}
                pattern="^[a-z0-9_]{3,24}$"
                minLength={3}
                maxLength={24}
                title="3–24 chars: lowercase letters, numbers, or underscores"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                required
                placeholder="@username"
              />
              <p className="text-xs text-gray-500">
                3–24 chars: lowercase letters, numbers, or underscores.
              </p>
              {usernameStatus === 'checking' && (
                <p className="text-xs text-gray-500" aria-live="polite">Checking availability…</p>
              )}
              {usernameStatus === 'available' && (
                <p className="text-xs text-green-600" aria-live="polite">Username is available.</p>
              )}
              {usernameStatus === 'taken' && (
                <p className="text-xs text-red-600" aria-live="polite">That username is already taken.</p>
              )}
              {usernameStatus === 'error' && (
                <p className="text-xs text-red-600" aria-live="polite">Couldn’t check availability. Try again.</p>
              )}
              {fieldErrors.username && (
                <p className="text-sm text-red-600">{fieldErrors.username}</p>
              )}
            </div>

            {/* Display name (read-only, derived) */}
            <div className="space-y-2">
              <Label htmlFor="display-name">Display Name</Label>
              <Input id="display-name" value={displayName} readOnly />
              <p className="text-xs text-gray-500">
                Display name is derived from your first and last name.
              </p>
            </div>

            {/* Bio */}
            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={2000}
                placeholder="Tell others about your faith journey..."
              />
              <div className="text-xs text-gray-500">{bio.length}/2000</div>
              {fieldErrors.bio && (
                <p className="text-sm text-red-600">{fieldErrors.bio}</p>
              )}
            </div>

            {/* Save */}
            <div className="flex items-center gap-3">
              <Button
                className="america-button"
                type="submit"
                disabled={
                  saving ||
                  loading ||
                  usernameStatus === 'taken' ||
                  usernameStatus === 'checking'
                }
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
              {justSaved && (
                <span className="text-sm text-green-600">Saved!</span>
              )}
              {generalError && (
                <span className="text-sm text-red-600">{generalError}</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Group Memberships */}
<Card>
  <CardHeader>
    <CardTitle>Group Memberships</CardTitle>
    <CardDescription>Groups you’ve joined</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    {groupsLoading && <div className="text-sm text-gray-600">Loading groups…</div>}
    {groupsError && <div className="text-sm text-red-600">{groupsError}</div>}

    {!groupsLoading && !groupsError && joinedGroups.length === 0 && (
      <div className="text-sm text-gray-600">
        You haven’t joined any groups yet.{' '}
        <Link to="/groups" className="underline">Explore groups</Link>
      </div>
    )}

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {joinedGroups.map((g) => (
        <Card key={g.id} className="p-4">
          <Link to={`/g/${g.id}`} className="underline text-sm font-medium">
            {g.name}
          </Link>
          {g.description && (
            <div className="text-xs text-gray-600 mt-1">{g.description}</div>
          )}
        </Card>
      ))}
    </div>
  </CardContent>
</Card>


        {/* Privacy Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Privacy & Notifications</CardTitle>
            <CardDescription>Control your privacy and notification preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label>Prayer Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Get notified when others pray for your requests
                </p>
              </div>
              <Switch />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label>Group Invitations</Label>
                <p className="text-sm text-muted-foreground">
                  Allow others to invite you to groups
                </p>
              </div>
              <Switch />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label>Public Profile</Label>
                <p className="text-sm text-muted-foreground">
                  Make your profile visible to other users
                </p>
                {isPublicError && (
                  <p className="text-sm text-red-600 mt-1">{isPublicError}</p>
                )}
                {!isPublicError && isPublicSavedAt && (
                  <p className="text-xs text-green-600 mt-1" aria-live="polite">Saved.</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={isPublic}
                  onCheckedChange={onTogglePublic}
                  disabled={isPublicSaving}
                />
                {isPublicSaving && (
                  <span className="text-xs text-gray-500">Saving…</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
