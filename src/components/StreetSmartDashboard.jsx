import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/api/client.js'

const PRIORITY_OPTIONS = ['low', 'moderate', 'high', 'critical']
const CARD_STYLE = {
  border: '1px solid #243252',
  borderRadius: 16,
  padding: 16,
  background: 'rgba(14, 22, 38, 0.88)',
  boxShadow: '0 18px 32px rgba(0, 0, 0, 0.18)',
}

const gridStyle = {
  display: 'grid',
  gap: 16,
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
}

function ZoneCard({ zone }) {
  const tint = zone.kind === 'safe' ? '#86efac' : '#fca5a5'
  return (
    <article style={{ ...CARD_STYLE, borderColor: zone.kind === 'safe' ? '#14532d' : '#7f1d1d' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong>{zone.name}</strong>
        <span style={{ color: tint, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {zone.kind} · {zone.status}
        </span>
      </div>
      <p style={{ marginBottom: 8, color: '#94a3b8' }}>
        {zone.city} · radius {zone.radiusMeters}m
      </p>
      <p style={{ margin: 0 }}>{zone.notes}</p>
    </article>
  )
}

function AdvisoryCard({ advisory }) {
  const severityColor = {
    low: '#93c5fd',
    medium: '#fde68a',
    high: '#fca5a5',
  }[advisory.severity] ?? '#cbd5f5'

  return (
    <article style={CARD_STYLE}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong>{advisory.title}</strong>
        <span style={{ color: severityColor, fontSize: 12, textTransform: 'uppercase' }}>{advisory.severity}</span>
      </div>
      <p style={{ color: '#94a3b8', marginBottom: 8 }}>
        {new Date(advisory.issuedAt).toLocaleString()} · {advisory.status}
      </p>
      <p>{advisory.summary}</p>
      <p style={{ marginBottom: 0, color: '#cbd5f5' }}>Action: {advisory.action}</p>
    </article>
  )
}

function IntelList({ intel, onDelete, deletingId }) {
  if (!intel.length) {
    return <p style={{ color: '#94a3b8' }}>No field reports yet. Log one before your next movement window.</p>
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {intel.map((entry) => (
        <article key={entry.id} style={CARD_STYLE}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <strong>{entry.title}</strong>
            <span style={{ textTransform: 'uppercase', fontSize: 12, color: '#fca5a5' }}>{entry.priority}</span>
          </div>
          <p style={{ color: '#94a3b8', marginBottom: 8 }}>
            {entry.location} · {new Date(entry.created_at).toLocaleString()}
          </p>
          <p>{entry.details}</p>
          <button
            type="button"
            onClick={() => onDelete(entry.id)}
            disabled={deletingId === entry.id}
            style={{ padding: '8px 12px', borderRadius: 8, background: 'transparent', color: '#fca5a5', border: '1px solid #7f1d1d' }}
          >
            {deletingId === entry.id ? 'Removing…' : 'Delete report'}
          </button>
        </article>
      ))}
    </div>
  )
}

export function StreetSmartDashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [briefing, setBriefing] = useState(null)
  const [zones, setZones] = useState([])
  const [advisories, setAdvisories] = useState([])
  const [intel, setIntel] = useState([])
  const [profile, setProfile] = useState(null)
  const [profileMessage, setProfileMessage] = useState('')
  const [profileMessageType, setProfileMessageType] = useState('info')
  const [intelMessage, setIntelMessage] = useState('')
  const [intelMessageType, setIntelMessageType] = useState('info')
  const [savingProfile, setSavingProfile] = useState(false)
  const [creatingIntel, setCreatingIntel] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [intelDraft, setIntelDraft] = useState({ title: '', details: '', priority: 'moderate', location: '' })
  const [profileDraft, setProfileDraft] = useState(null)

  async function loadDashboard() {
    setLoading(true)
    setError('')

    try {
      const [briefingResponse, zonesResponse, advisoriesResponse, intelResponse, profileResponse] = await Promise.all([
        apiClient.getBriefing(),
        apiClient.listZones(),
        apiClient.listAdvisories(),
        apiClient.listIntel(),
        apiClient.getProfile(),
      ])
      setBriefing(briefingResponse.briefing)
      setZones(zonesResponse.zones ?? [])
      setAdvisories(advisoriesResponse.advisories ?? [])
      setIntel(intelResponse.intel ?? [])
      setProfile(profileResponse.profile)
      setProfileDraft({
        callSign: profileResponse.profile.call_sign,
        homeZoneId: profileResponse.profile.home_zone_id,
        pinEnabled: profileResponse.profile.pin_enabled,
        biometricEnabled: profileResponse.profile.biometric_enabled,
        threatOverrideEnabled: profileResponse.profile.threat_override_enabled,
        stealthModeEnabled: profileResponse.profile.stealth_mode_enabled,
        emergencyContacts: profileResponse.profile.emergency_contacts?.length
          ? profileResponse.profile.emergency_contacts
          : [{ name: '', phone: '', relationship: '' }],
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDashboard()
  }, [])

  const zoneOptions = useMemo(() => zones.filter((zone) => zone.kind === 'safe'), [zones])

  function updateProfileField(field, value) {
    setProfileDraft((current) => ({ ...current, [field]: value }))
  }

  function updateContact(index, field, value) {
    setProfileDraft((current) => ({
      ...current,
      emergencyContacts: current.emergencyContacts.map((contact, contactIndex) =>
        contactIndex === index ? { ...contact, [field]: value } : contact,
      ),
    }))
  }

  function addContact() {
    setProfileDraft((current) => ({
      ...current,
      emergencyContacts: [...current.emergencyContacts, { name: '', phone: '', relationship: '' }],
    }))
  }

  function removeContact(index) {
    setProfileDraft((current) => ({
      ...current,
      emergencyContacts: current.emergencyContacts.filter((_, contactIndex) => contactIndex !== index),
    }))
  }

  async function onCreateIntel(event) {
    event.preventDefault()
    setIntelMessage('')
    setIntelMessageType('info')
    setCreatingIntel(true)

    try {
      const response = await apiClient.createIntel(intelDraft)
      setIntel((current) => [response.intel, ...current])
      setIntelDraft({ title: '', details: '', priority: 'moderate', location: '' })
      setIntelMessage('Field report logged.')
      setIntelMessageType('success')
      const briefingResponse = await apiClient.getBriefing()
      setBriefing(briefingResponse.briefing)
    } catch (requestError) {
      setIntelMessage(requestError.message)
      setIntelMessageType('error')
    } finally {
      setCreatingIntel(false)
    }
  }

  async function onDeleteIntel(id) {
    setDeletingId(id)
    setIntelMessage('')
    setIntelMessageType('info')

    try {
      await apiClient.deleteIntel(id)
      setIntel((current) => current.filter((entry) => entry.id !== id))
      setIntelMessage('Field report removed.')
      setIntelMessageType('success')
      const briefingResponse = await apiClient.getBriefing()
      setBriefing(briefingResponse.briefing)
    } catch (requestError) {
      setIntelMessage(requestError.message)
      setIntelMessageType('error')
    } finally {
      setDeletingId('')
    }
  }

  async function onSaveProfile(event) {
    event.preventDefault()
    setSavingProfile(true)
    setProfileMessage('')
    setProfileMessageType('info')

    try {
      const response = await apiClient.updateProfile(profileDraft)
      setProfile(response.profile)
      setProfileDraft({
        callSign: response.profile.call_sign,
        homeZoneId: response.profile.home_zone_id,
        pinEnabled: response.profile.pin_enabled,
        biometricEnabled: response.profile.biometric_enabled,
        threatOverrideEnabled: response.profile.threat_override_enabled,
        stealthModeEnabled: response.profile.stealth_mode_enabled,
        emergencyContacts: response.profile.emergency_contacts,
      })
      const briefingResponse = await apiClient.getBriefing()
      setBriefing(briefingResponse.briefing)
      setProfileMessage('Security posture updated.')
      setProfileMessageType('success')
    } catch (requestError) {
      setProfileMessage(requestError.message)
      setProfileMessageType('error')
    } finally {
      setSavingProfile(false)
    }
  }

  if (loading) {
    return <p>Loading operational dashboard…</p>
  }

  if (error) {
    return <p style={{ color: '#fca5a5' }}>{error}</p>
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section style={{ ...CARD_STYLE, background: 'linear-gradient(135deg, rgba(22, 40, 76, 0.95), rgba(13, 22, 40, 0.95))' }}>
        <p style={{ marginTop: 0, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#93c5fd', fontSize: 12 }}>
          Threat briefing · {briefing.threatLevel}
        </p>
        <h2 style={{ marginTop: 0 }}>{briefing.headline}</h2>
        <p style={{ maxWidth: 760 }}>{briefing.summary}</p>
        <div style={gridStyle}>
          <div>
            <strong>{briefing.safeZoneCount}</strong>
            <p style={{ margin: '4px 0 0', color: '#94a3b8' }}>Safe zones</p>
          </div>
          <div>
            <strong>{briefing.dangerZoneCount}</strong>
            <p style={{ margin: '4px 0 0', color: '#94a3b8' }}>Danger zones</p>
          </div>
          <div>
            <strong>{briefing.activeAdvisoryCount}</strong>
            <p style={{ margin: '4px 0 0', color: '#94a3b8' }}>Active advisories</p>
          </div>
          <div>
            <strong>{briefing.securityPosture.emergencyContactCount}</strong>
            <p style={{ margin: '4px 0 0', color: '#94a3b8' }}>Emergency contacts</p>
          </div>
        </div>
        {briefing.homeZone ? (
          <p style={{ marginBottom: 0, color: '#cbd5f5' }}>
            Home zone: <strong>{briefing.homeZone.name}</strong> · next check-in {new Date(briefing.nextCheckInAt).toLocaleTimeString()}
          </p>
        ) : null}
      </section>

      <section>
        <h2>Tactical zones</h2>
        <div style={gridStyle}>
          {zones.map((zone) => (
            <ZoneCard key={zone.id} zone={zone} />
          ))}
        </div>
      </section>

      <section>
        <h2>Active advisories</h2>
        <div style={gridStyle}>
          {advisories.map((advisory) => (
            <AdvisoryCard key={advisory.id} advisory={advisory} />
          ))}
        </div>
      </section>

      <section style={gridStyle}>
        <div>
          <h2>Intel log</h2>
          <form onSubmit={onCreateIntel} style={{ ...CARD_STYLE, display: 'grid', gap: 12, marginBottom: 16 }}>
            <input
              value={intelDraft.title}
              onChange={(event) => setIntelDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="Report title"
              style={{ padding: 10, borderRadius: 10, border: '1px solid #304163', background: '#071120', color: '#e5ecff' }}
            />
            <input
              value={intelDraft.location}
              onChange={(event) => setIntelDraft((current) => ({ ...current, location: event.target.value }))}
              placeholder="Location or zone"
              style={{ padding: 10, borderRadius: 10, border: '1px solid #304163', background: '#071120', color: '#e5ecff' }}
            />
            <select
              value={intelDraft.priority}
              onChange={(event) => setIntelDraft((current) => ({ ...current, priority: event.target.value }))}
              style={{ padding: 10, borderRadius: 10, border: '1px solid #304163', background: '#071120', color: '#e5ecff' }}
            >
              {PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
            <textarea
              value={intelDraft.details}
              onChange={(event) => setIntelDraft((current) => ({ ...current, details: event.target.value }))}
              placeholder="What changed on the ground?"
              rows={4}
              style={{ padding: 10, borderRadius: 10, border: '1px solid #304163', background: '#071120', color: '#e5ecff' }}
            />
            <button type="submit" disabled={creatingIntel} style={{ padding: '10px 14px', borderRadius: 10 }}>
              {creatingIntel ? 'Logging…' : 'Log field report'}
            </button>
            {intelMessage ? (
              <p style={{ margin: 0, color: intelMessageType === 'error' ? '#fca5a5' : '#93c5fd' }}>{intelMessage}</p>
            ) : null}
          </form>
          <IntelList intel={intel} onDelete={onDeleteIntel} deletingId={deletingId} />
        </div>

        <div>
          <h2>Profile & security</h2>
          {profile && profileDraft ? (
            <form onSubmit={onSaveProfile} style={{ ...CARD_STYLE, display: 'grid', gap: 12 }}>
              <input
                value={profileDraft.callSign}
                onChange={(event) => updateProfileField('callSign', event.target.value)}
                placeholder="Call sign"
                style={{ padding: 10, borderRadius: 10, border: '1px solid #304163', background: '#071120', color: '#e5ecff' }}
              />
              <select
                value={profileDraft.homeZoneId}
                onChange={(event) => updateProfileField('homeZoneId', event.target.value)}
                style={{ padding: 10, borderRadius: 10, border: '1px solid #304163', background: '#071120', color: '#e5ecff' }}
              >
                {zoneOptions.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
              {[
                ['pinEnabled', 'PIN lock'],
                ['biometricEnabled', 'Biometric unlock'],
                ['threatOverrideEnabled', 'Threat override'],
                ['stealthModeEnabled', 'Stealth / low-light mode'],
              ].map(([field, label]) => (
                <label key={field} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(profileDraft[field])}
                    onChange={(event) => updateProfileField(field, event.target.checked)}
                  />
                  {label}
                </label>
              ))}

              <div style={{ display: 'grid', gap: 10 }}>
                <strong>Emergency contacts</strong>
                {profileDraft.emergencyContacts.map((contact, index) => (
                  <div key={`${contact.name}-${index}`} style={{ display: 'grid', gap: 8, padding: 12, borderRadius: 12, border: '1px solid #304163' }}>
                    <input
                      value={contact.name}
                      onChange={(event) => updateContact(index, 'name', event.target.value)}
                      placeholder="Name"
                      style={{ padding: 10, borderRadius: 10, border: '1px solid #304163', background: '#071120', color: '#e5ecff' }}
                    />
                    <input
                      value={contact.phone}
                      onChange={(event) => updateContact(index, 'phone', event.target.value)}
                      placeholder="Phone or signal handle"
                      style={{ padding: 10, borderRadius: 10, border: '1px solid #304163', background: '#071120', color: '#e5ecff' }}
                    />
                    <input
                      value={contact.relationship}
                      onChange={(event) => updateContact(index, 'relationship', event.target.value)}
                      placeholder="Relationship"
                      style={{ padding: 10, borderRadius: 10, border: '1px solid #304163', background: '#071120', color: '#e5ecff' }}
                    />
                    {profileDraft.emergencyContacts.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeContact(index)}
                        style={{ padding: '8px 12px', borderRadius: 8, background: 'transparent', color: '#fca5a5', border: '1px solid #7f1d1d' }}
                      >
                        Remove contact
                      </button>
                    ) : null}
                  </div>
                ))}
                <button type="button" onClick={addContact} style={{ padding: '10px 14px', borderRadius: 10 }}>
                  Add contact
                </button>
              </div>

              <button type="submit" disabled={savingProfile} style={{ padding: '10px 14px', borderRadius: 10 }}>
                {savingProfile ? 'Saving…' : 'Save security posture'}
              </button>
              {profileMessage ? (
                <p style={{ margin: 0, color: profileMessageType === 'error' ? '#fca5a5' : '#93c5fd' }}>{profileMessage}</p>
              ) : null}
            </form>
          ) : null}
        </div>
      </section>
    </div>
  )
}
